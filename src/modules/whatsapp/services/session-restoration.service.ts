import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client } from 'whatsapp-web.js';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { SessionManagerService } from './session-manager.service';
import { EventHandlerService } from './event-handler.service';
import { FileManagerService } from './file-manager.service';
import { MessageHandlerService } from './message-handler.service';
import * as path from 'path';

type SessionAuthResult = 'ready' | 'qr' | 'auth_failure' | 'timeout';

@Injectable()
export class SessionRestorationService {
    private readonly logger = new Logger(SessionRestorationService.name);
    private readonly AUTH_WAIT_MS = Number(process.env.WHATSAPP_RESTORE_AUTH_WAIT_MS) || 60_000;
    private readonly RESTORE_GAP_MS = Number(process.env.WHATSAPP_RESTORE_GAP_MS) || 3000;

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly sessionManager: SessionManagerService,
        private readonly eventHandler: EventHandlerService,
        private readonly fileManager: FileManagerService,
        private readonly messageHandler: MessageHandlerService,
    ) { }

    async loadClientsFromSessions() {
        try {
            this.logger.log('🔄 Starting session restoration process...');

            const sessionFolders = this.fileManager.loadSessionFolders();
            this.logger.log(`📁 Found ${sessionFolders.length} session folders`);

            const clientIds = sessionFolders.map(folder => folder.replace('session-', ''));
            const accounts = await this.accountModel.find({
                clientId: { $in: clientIds },
            }).lean();

            const accountMap = new Map(accounts.map(acc => [acc.clientId, acc]));
            this.logger.log(`📋 Found ${accounts.length} accounts matching session folders (including disconnected)`);

            for (const folder of sessionFolders) {
                const clientId = folder.replace('session-', '');
                const sessionPath = path.join(process.cwd(), '.wwebjs_auth', folder);

                if (!this.fileManager.isValidSession(sessionPath)) {
                    this.logger.warn(`❌ Invalid or empty auth data for ${clientId}, skipping restore`);
                    if (!accountMap.has(clientId)) {
                        await this.fileManager.cleanupSessionFiles(clientId);
                    }
                    continue;
                }

                const account = accountMap.get(clientId);
                if (!account) {
                    this.logger.warn(`❌ No account document for session ${clientId}, cleaning up orphan session...`);
                    await this.fileManager.cleanupSessionFiles(clientId);
                    continue;
                }

                if (this.sessionManager.getClientState(clientId)) {
                    this.logger.log(`✅ Session ${clientId} already loaded in memory, skipping...`);
                    continue;
                }

                if (this.sessionManager.isClientReady(clientId)) {
                    this.logger.log(`✅ Session ${clientId} already active, skipping...`);
                    continue;
                }

                if (account.status === 'disconnected') {
                    this.logger.log(`🔄 Attempting restore for previously disconnected account ${clientId}`);
                }

                await this.restoreSessionSilently(clientId, account.user.toString());
                await new Promise(r => setTimeout(r, this.RESTORE_GAP_MS));
            }

            this.logger.log(`✅ Session restoration completed. Active sessions: ${this.sessionManager.getActiveSessionCount()}`);
        } catch (error) {
            this.logger.error(`❌ Failed to load sessions: ${error.message}`);
        }
    }

    private async restoreSessionSilently(clientId: string, userId: string) {
        let client: Client | undefined;

        try {
            this.logger.log(`🔄 Restoring session ${clientId} silently...`);

            client = await this.sessionManager.createSession(clientId, userId, true);
            this.eventHandler.setupRestoredSessionHandlers(client, clientId, userId);

            await client.initialize();

            const authResult = await this.waitForSessionAuth(client, this.AUTH_WAIT_MS);
            if (authResult !== 'ready') {
                throw new Error(`Auth not restored (${authResult}) — QR scan required from the app`);
            }

            this.logger.log(`✅ Session ${clientId} restored and authenticated`);
        } catch (error) {
            this.logger.warn(`⚠️ Could not restore session ${clientId}: ${error.message}`);
            await this.teardownUnrestorableSession(clientId, client, String(error.message));
        }
    }

    /**
     * Resolves when the session reaches ready, needs QR, fails auth, or times out.
     * QR during silent restore means on-disk auth is stale — caller should tear down the client.
     */
    waitForSessionAuth(client: Client, timeoutMs: number): Promise<SessionAuthResult> {
        return new Promise((resolve) => {
            let settled = false;

            const finish = (result: SessionAuthResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                client.off('ready', onReady);
                client.off('qr', onQr);
                client.off('auth_failure', onAuthFailure);
                resolve(result);
            };

            const onReady = () => finish('ready');
            const onQr = () => finish('qr');
            const onAuthFailure = () => finish('auth_failure');

            client.once('ready', onReady);
            client.once('qr', onQr);
            client.once('auth_failure', onAuthFailure);

            const timer = setTimeout(() => finish('timeout'), timeoutMs);
        });
    }

    private async teardownUnrestorableSession(
        clientId: string,
        client: Client | undefined,
        reason: string,
    ): Promise<void> {
        const state = this.sessionManager.getClientState(clientId);
        const activeClient = client ?? state?.client;

        if (activeClient) {
            try {
                activeClient.removeAllListeners();
            } catch { /* ignore */ }
            try {
                await activeClient.destroy();
            } catch (e: any) {
                this.logger.debug(`Destroy after failed restore for ${clientId}: ${e?.message}`);
            }
        }

        this.sessionManager.removeSession(clientId);

        await this.accountModel.updateOne(
            { clientId },
            {
                $set: {
                    status: 'disconnected',
                    'sessionData.authState': 'needs_qr',
                },
            },
        );

        this.logger.warn(
            `📵 Session ${clientId} paused in memory (${reason}). Auth files on disk are preserved — use Scan QR to reconnect.`,
        );
    }

    private isLogoutReason(reason: string): boolean {
        return (
            reason.toLowerCase().includes('logout') ||
            reason.toLowerCase().includes('conflict') ||
            reason.toLowerCase().includes('logged out')
        );
    }

    private async cleanupLoggedOutSession(clientId: string): Promise<void> {
        try {
            this.logger.log(`🧹 Starting logout cleanup for ${clientId}`);

            const clientState = this.sessionManager.getClientState(clientId);
            if (clientState?.client) {
                try {
                    clientState.client.removeAllListeners();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await clientState.client.destroy();
                    this.logger.debug(`✅ Client destroyed for ${clientId}`);
                } catch (destroyError) {
                    this.logger.warn(`Warning during client destruction for ${clientId}: ${destroyError.message}`);
                }
            }

            await this.fileManager.cleanupSessionFiles(clientId, true);
            this.sessionManager.removeSession(clientId);

            const account = await this.accountModel.findOne({ clientId }).exec();
            if (account) {
                await this.accountModel.deleteOne({ _id: account._id }).exec();
                this.logger.log(`✅ Account ${account._id} deleted after logout`);
            }

            this.logger.log(`✅ Logout cleanup completed for ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Error cleaning up logged out session ${clientId}: ${error.message}`);
        }
    }

    async restoreSpecificSession(clientId: string, userId: string, emit?: (event: string, data: any) => void): Promise<boolean> {
        try {
            this.logger.log(`🔄 Restoring specific session ${clientId} with events...`);

            if (this.sessionManager.getClientState(clientId)) {
                const ready = this.sessionManager.isClientReady(clientId);
                if (ready) {
                    this.logger.log(`Session ${clientId} already active`);
                    return true;
                }
                const state = this.sessionManager.getClientState(clientId);
                if (state?.client) {
                    try {
                        state.client.removeAllListeners();
                        await state.client.destroy();
                    } catch (e: any) {
                        this.logger.debug(`Teardown before restore ${clientId}: ${e?.message}`);
                    }
                }
                this.sessionManager.removeSession(clientId);
            }

            const client = await this.sessionManager.createSession(clientId, userId, true);

            if (emit) {
                this.eventHandler.setupEventHandlers(client, clientId, emit, userId, { enableQr: true });
            } else {
                this.eventHandler.setupRestoredSessionHandlers(client, clientId, userId);
            }

            await client.initialize();

            if (!emit) {
                const authResult = await this.waitForSessionAuth(client, this.AUTH_WAIT_MS);
                if (authResult !== 'ready') {
                    await this.teardownUnrestorableSession(clientId, client, `Auth not restored (${authResult})`);
                    return false;
                }
            }

            this.logger.log(`✅ Session ${clientId} restored with full event handling`);
            return true;
        } catch (error) {
            this.logger.error(`❌ Failed to restore specific session ${clientId}: ${error.message}`);

            this.sessionManager.removeSession(clientId);
            return false;
        }
    }
}
