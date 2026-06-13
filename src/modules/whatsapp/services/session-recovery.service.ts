import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client } from 'whatsapp-web.js';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { SessionManagerService } from './session-manager.service';
import { EventHandlerService } from './event-handler.service';

/**
 * Rebuilds a WhatsApp client from LocalAuth after Puppeteer / browser death.
 * Soft `client.initialize()` alone is often not enough once the page or browser is gone.
 */
@Injectable()
export class SessionRecoveryService {
    private readonly logger = new Logger(SessionRecoveryService.name);
    private readonly recoveryLocks = new Map<string, Promise<boolean>>();

    constructor(
        @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
        private readonly sessionManager: SessionManagerService,
        @Inject(forwardRef(() => EventHandlerService))
        private readonly eventHandler: EventHandlerService,
    ) { }

    /**
     * Destroy the in-memory client (if any), drop state while keeping socket → clientId mappings,
     * then create a new Client + handlers + initialize from disk auth.
     */
    async recreateClientFromAuth(clientId: string): Promise<boolean> {
        const existing = this.recoveryLocks.get(clientId);
        if (existing) {
            return existing;
        }

        const job = this.runRecreate(clientId).finally(() => {
            this.recoveryLocks.delete(clientId);
        });
        this.recoveryLocks.set(clientId, job);
        return job;
    }

    private async runRecreate(clientId: string): Promise<boolean> {
        const account = await this.accountModel.findOne({ clientId }).lean();
        if (!account) {
            this.logger.warn(`Cannot recover ${clientId}: no account document`);
            return false;
        }

        const userId = account.user?.toString?.();
        if (!userId) {
            this.logger.warn(`Cannot recover ${clientId}: account has no user`);
            return false;
        }

        this.logger.log(`🔁 Full session rebuild starting for ${clientId}`);

        const prior = this.sessionManager.getClientState(clientId);
        if (prior?.client) {
            try {
                prior.client.removeAllListeners();
            } catch (e: any) {
                this.logger.debug(`removeAllListeners for ${clientId}: ${e?.message}`);
            }
            try {
                await this.withTimeout(
                    prior.client.destroy(),
                    25_000,
                    `destroy-${clientId}`,
                );
            } catch (e: any) {
                this.logger.warn(`Destroy failed for ${clientId} (continuing rebuild): ${e?.message}`);
            }
        }

        this.sessionManager.removeSession(clientId, { preserveSocketMappings: true });

        try {
            const client = await this.sessionManager.createSession(clientId, userId, true);
            this.eventHandler.setupRestoredSessionHandlers(client, clientId, userId);

            await this.withTimeout(
                client.initialize(),
                120_000,
                `initialize-${clientId}`,
            );

            const authResult = await this.waitForConnected(client, clientId);
            if (authResult !== 'ready') {
                this.logger.error(`❌ Full session rebuild for ${clientId}: auth not restored (${authResult})`);
                try {
                    client.removeAllListeners();
                    await client.destroy();
                } catch { /* ignore */ }
                this.sessionManager.removeSession(clientId, { preserveSocketMappings: true });
                return false;
            }

            this.sessionManager.updateClientState(clientId, {
                isReady: true,
                reconnectAttempts: 0,
                lastActivity: Date.now(),
            });
            await this.sessionManager.saveSessionState(clientId);

            this.logger.log(`✅ Full session rebuild finished for ${clientId}`);
            return true;
        } catch (error: any) {
            this.logger.error(`❌ Full session rebuild failed for ${clientId}: ${error?.message}`);
            this.sessionManager.removeSession(clientId, { preserveSocketMappings: true });
            return false;
        }
    }

    private waitForConnected(
        client: Client,
        clientId: string,
    ): Promise<'ready' | 'qr' | 'auth_failure' | 'timeout'> {
        const timeoutMs = Number(process.env.WHATSAPP_RESTORE_AUTH_WAIT_MS) || 60_000;

        return new Promise((resolve) => {
            let settled = false;

            const finish = (result: 'ready' | 'qr' | 'auth_failure' | 'timeout') => {
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

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }
}
