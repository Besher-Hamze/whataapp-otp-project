import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { SessionManagerService } from './session-manager.service';
import { EventHandlerService } from './event-handler.service';
import { FileManagerService } from './file-manager.service';
import { MessageHandlerService } from './message-handler.service'; // ✅ Add this import
import * as path from 'path';

@Injectable()
export class SessionRestorationService {
    private readonly logger = new Logger(SessionRestorationService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly sessionManager: SessionManagerService,
        private readonly eventHandler: EventHandlerService,
        private readonly fileManager: FileManagerService,
        private readonly messageHandler: MessageHandlerService, // ✅ Add this dependency
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
                    this.logger.warn(`❌ Invalid session files for ${clientId}, cleaning up orphan session...`);
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

                if (this.sessionManager.isClientReady(clientId)) {
                    this.logger.log(`✅ Session ${clientId} already active, skipping...`);
                    continue;
                }

                if (account.status === 'disconnected') {
                    this.logger.log(`🔄 Attempting restore for previously disconnected account ${clientId}`);
                }

                await this.restoreSessionSilently(clientId, account.user.toString());
            }

            this.logger.log(`✅ Session restoration completed. Active sessions: ${this.sessionManager.getActiveSessionCount()}`);
        } catch (error) {
            this.logger.error(`❌ Failed to load sessions: ${error.message}`);
        }
    }

    private async restoreSessionSilently(clientId: string, userId: string) {
        try {
            this.logger.log(`🔄 Restoring session ${clientId} silently with full message handling...`);

            const client = await this.sessionManager.createSession(clientId, userId, true);

            // ✅ OPTION 1: Use full event handlers for restored sessions (RECOMMENDED)
            // Create a no-op emit function for restored sessions
            const silentEmit = (event: string, data: any) => {
                this.logger.debug(`📡 Silent restored session event: ${event} for ${clientId}`);
                // You can add any silent event handling here if needed
            };

            // Set up FULL event handlers including message handling
            this.eventHandler.setupEventHandlers(client, clientId, silentEmit, userId);

            // ✅ ALTERNATIVE OPTION 2: Use enhanced restored session events (if you prefer minimal setup)
            // this.setupEnhancedRestoredSessionEvents(client, clientId, userId);

            // Initialize the client
            await client.initialize();

            this.logger.log(`✅ Session ${clientId} restored successfully with full message handling`);
        } catch (error) {
            this.logger.error(`❌ Failed to restore session ${clientId}: ${error.message}`);

            this.sessionManager.removeSession(clientId);

            await this.accountModel.updateOne(
                { clientId },
                {
                    $set: {
                        status: 'disconnected',
                        'sessionData.isAuthenticated': false,
                        'sessionData.sessionValid': false,
                        'sessionData.authState': 'failed',
                    },
                },
            );
        }
    }

    // ✅ ALTERNATIVE: Enhanced restored session events with message handling
    private setupEnhancedRestoredSessionEvents(client: any, clientId: string, userId: string): void {
        let isCleaningUp = false;
        let isLoggedOut = false;

        this.logger.log(`🔧 Setting up enhanced restored session events with message handling for ${clientId}`);

        // ✅ CRITICAL: Add full message handling for restored sessions
        client.on('message', async (message) => {
            try {
                if (isCleaningUp || isLoggedOut) return;

                this.logger.log(`📨 RESTORED SESSION - Message received for ${clientId} from ${message.from}`);

                // Update last activity
                this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });

                // ✅ PROCESS MESSAGE THROUGH FULL PIPELINE (same as new sessions)
                await this.messageHandler.handleIncomingMessage(message, clientId);

                this.logger.log(`✅ RESTORED SESSION - Message processed for ${clientId}`);
            } catch (error) {
                this.logger.error(`❌ Error handling message in restored session ${clientId}: ${error.message}`);
            }
        });

        // Handle ready event
        client.on('ready', async () => {
            if (isCleaningUp || isLoggedOut) return;

            this.sessionManager.updateClientState(clientId, {
                isReady: true,
                lastActivity: Date.now(),
                reconnectAttempts: 0
            });
            await this.sessionManager.saveSessionState(clientId);

            // ✅ Log message handler status for restored sessions
            this.logger.log(`✅ Restored session ${clientId} is ready - Message handlers: ${this.messageHandler.getHandlerCount()}`);
        });

        // Handle disconnection
        client.on('disconnected', async (reason: string) => {
            if (isCleaningUp) return;

            this.logger.warn(`🔌 Restored session ${clientId} disconnected: ${reason}`);
            await this.sessionManager.markSessionAsDisconnected(clientId);
            this.sessionManager.updateClientState(clientId, { isReady: false });

            if (this.isLogoutReason(reason)) {
                isLoggedOut = true;
                isCleaningUp = true;

                this.logger.log(`🔒 Session ${clientId} logged out, cleaning up...`);

                try {
                    client.removeAllListeners();
                } catch (error) {
                    this.logger.debug(`Could not remove listeners: ${error.message}`);
                }

                setTimeout(async () => {
                    try {
                        await this.cleanupLoggedOutSession(clientId);
                    } catch (error) {
                        this.logger.error(`❌ Logout cleanup failed for ${clientId}: ${error.message}`);
                    }
                }, 1000);
            }
        });

        // Handle auth failure
        client.on('auth_failure', async () => {
            if (isCleaningUp || isLoggedOut) return;

            this.logger.error(`🚫 Restored session ${clientId} auth failed`);
            await this.sessionManager.markSessionAsDisconnected(clientId);
            this.sessionManager.removeSession(clientId);
        });

        // Handle errors
        client.on('error', (error: Error) => {
            if (isCleaningUp || isLoggedOut) return;

            if (error.message.includes('Protocol error') && error.message.includes('Session closed')) {
                this.logger.debug(`Ignoring protocol error during logout for ${clientId}: ${error.message}`);
                return;
            }

            this.logger.error(`❌ Restored session ${clientId} error: ${error.message}`);
        });

        // Handle authentication
        client.on('authenticated', () => {
            if (isCleaningUp || isLoggedOut) return;
            this.logger.log(`🔐 Restored session ${clientId} authenticated`);
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });

        this.logger.log(`✅ Enhanced restored session events setup completed for ${clientId}`);
    }

    // ✅ Keep the original minimal setup as a fallback option
    private setupRestoredSessionEvents(client: any, clientId: string): void {
        // ... keep your original implementation for backward compatibility
        this.setupEnhancedRestoredSessionEvents(client, clientId, 'unknown');
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

            const client = await this.sessionManager.createSession(clientId, userId, true);

            // ✅ ALWAYS use full event handlers for specific session restoration
            if (emit) {
                this.eventHandler.setupEventHandlers(client, clientId, emit, userId);
            } else {
                // Use silent emit for manual restoration
                const silentEmit = (event: string, data: any) => {
                    this.logger.debug(`📡 Silent manual session event: ${event} for ${clientId}`);
                };
                this.eventHandler.setupEventHandlers(client, clientId, silentEmit, userId);
            }

            await client.initialize();

            this.logger.log(`✅ Session ${clientId} restored with full event handling`);
            return true;
        } catch (error) {
            this.logger.error(`❌ Failed to restore specific session ${clientId}: ${error.message}`);

            this.sessionManager.removeSession(clientId);
            return false;
        }
    }
}