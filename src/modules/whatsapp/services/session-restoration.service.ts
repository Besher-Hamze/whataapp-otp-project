import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { SessionManagerService } from './session-manager.service';
import { EventHandlerService } from './event-handler.service';
import { FileManagerService } from './file-manager.service';
import * as path from 'path';

@Injectable()
export class SessionRestorationService {
    private readonly logger = new Logger(SessionRestorationService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly sessionManager: SessionManagerService,
        private readonly eventHandler: EventHandlerService,
        private readonly fileManager: FileManagerService,
    ) { }

    async loadClientsFromSessions() {
        try {
            this.logger.log('🔄 Starting session restoration process...');
            
            const sessionFolders = this.fileManager.loadSessionFolders();
            this.logger.log(`📁 Found ${sessionFolders.length} session folders`);

            // Get accounts that should have active sessions
            const activeAccounts = await this.accountModel.find({
                status: { $in: ['active', 'ready'] },
                clientId: { $exists: true, $ne: null },
                'sessionData.sessionValid': true
            }).lean();

            const accountMap = new Map(activeAccounts.map(acc => [acc.clientId, acc]));
            this.logger.log(`📋 Found ${activeAccounts.length} accounts with valid sessions to restore`);

            for (const folder of sessionFolders) {
                const clientId = folder.replace('session-', '');
                const sessionPath = path.join(process.cwd(), '.wwebjs_auth', folder);

                // Validate session files
                if (!this.fileManager.isValidSession(sessionPath)) {
                    this.logger.warn(`❌ Invalid session files for ${clientId}, cleaning up...`);
                    await this.fileManager.cleanupSessionFiles(clientId);
                    continue;
                }

                // Check if account exists and is active
                const account = accountMap.get(clientId);
                if (!account) {
                    this.logger.warn(`❌ No active account found for session ${clientId}, cleaning up...`);
                    await this.fileManager.cleanupSessionFiles(clientId);
                    continue;
                }

                // Check if session is already restored
                if (this.sessionManager.isClientReady(clientId)) {
                    this.logger.log(`✅ Session ${clientId} already active, skipping...`);
                    continue;
                }

                // Restore the session
                await this.restoreSessionSilently(clientId, account.user.toString());
            }

            this.logger.log(`✅ Session restoration completed. Active sessions: ${this.sessionManager.getActiveSessionCount()}`);
        } catch (error) {
            this.logger.error(`❌ Failed to load sessions: ${error.message}`);
        }
    }

    private async restoreSessionSilently(clientId: string, userId: string) {
        try {
            this.logger.log(`🔄 Restoring session ${clientId} silently...`);
            
            const client = await this.sessionManager.createSession(clientId, userId, true);
            
            // Set up minimal event handlers for restored sessions
            this.setupRestoredSessionEvents(client, clientId);
            
            // Initialize the client
            await client.initialize();
            
            this.logger.log(`✅ Session ${clientId} restored successfully`);
        } catch (error) {
            this.logger.error(`❌ Failed to restore session ${clientId}: ${error.message}`);
            
            try {
                await this.fileManager.cleanupSessionFiles(clientId, false); // Non-force cleanup for failed restore
            } catch (cleanupError) {
                this.logger.warn(`Warning: Could not cleanup files for failed restore ${clientId}: ${cleanupError.message}`);
            }
            
            this.sessionManager.removeSession(clientId);
            
            // Mark account as disconnected
            await this.accountModel.updateOne(
                { clientId },
                { 
                    $set: { 
                        status: 'disconnected',
                        'sessionData.isAuthenticated': false,
                        'sessionData.sessionValid': false,
                        'sessionData.authState': 'failed'
                    }
                }
            );
        }
    }

    private setupRestoredSessionEvents(client: any, clientId: string): void {
        let isCleaningUp = false;
        let isLoggedOut = false;

        // Handle ready event
        client.on('ready', async () => {
            if (isCleaningUp || isLoggedOut) return;
            
            this.sessionManager.updateClientState(clientId, { 
                isReady: true, 
                lastActivity: Date.now(),
                reconnectAttempts: 0 
            });
            await this.sessionManager.saveSessionState(clientId);
            this.logger.log(`✅ Restored session ${clientId} is ready`);
        });

        // Handle disconnection
        client.on('disconnected', async (reason: string) => {
            if (isCleaningUp) return;
            
            this.logger.warn(`🔌 Restored session ${clientId} disconnected: ${reason}`);
            await this.sessionManager.markSessionAsDisconnected(clientId);
            this.sessionManager.updateClientState(clientId, { isReady: false });

            // Check if this is a logout
            if (this.isLogoutReason(reason)) {
                isLoggedOut = true;
                isCleaningUp = true;
                
                this.logger.log(`🔒 Session ${clientId} logged out, cleaning up...`);
                
                // Immediately remove all listeners to prevent further events
                try {
                    client.removeAllListeners();
                } catch (error) {
                    this.logger.debug(`Could not remove listeners: ${error.message}`);
                }
                
                // Schedule cleanup after a short delay to let any pending operations complete
                setTimeout(async () => {
                    try {
                        await this.cleanupLoggedOutSession(clientId);
                    } catch (error) {
                        this.logger.error(`❌ Logout cleanup failed for ${clientId}: ${error.message}`);
                        // Never let cleanup errors crash the application
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
            
            // Ignore protocol errors that happen during logout
            if (error.message.includes('Protocol error') && error.message.includes('Session closed')) {
                this.logger.debug(`Ignoring protocol error during logout for ${clientId}: ${error.message}`);
                return;
            }
            
            this.logger.error(`❌ Restored session ${clientId} error: ${error.message}`);
        });

        // Handle message events to update activity
        client.on('message', () => {
            if (isCleaningUp || isLoggedOut) return;
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });

        // Handle authentication
        client.on('authenticated', () => {
            if (isCleaningUp || isLoggedOut) return;
            this.logger.log(`🔐 Restored session ${clientId} authenticated`);
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });
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
            
            // First, try to get the client and properly destroy it
            const clientState = this.sessionManager.getClientState(clientId);
            if (clientState?.client) {
                try {
                    // Remove all listeners first to prevent race conditions
                    clientState.client.removeAllListeners();
                    
                    // Give a moment for any pending operations to complete
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Destroy the client
                    await clientState.client.destroy();
                    this.logger.debug(`✅ Client destroyed for ${clientId}`);
                } catch (destroyError) {
                    this.logger.warn(`Warning during client destruction for ${clientId}: ${destroyError.message}`);
                }
            }
            
            // Clean up files with force flag for logout
            await this.fileManager.cleanupSessionFiles(clientId, true);
            
            // Remove from session manager
            this.sessionManager.removeSession(clientId);
            
            // Update account in database
            const account = await this.accountModel.findOne({ clientId }).exec();
            if (account) {
                await this.accountModel.deleteOne({ _id: account._id }).exec();
                this.logger.log(`✅ Account ${account._id} deleted after logout`);
            }
            
            this.logger.log(`✅ Logout cleanup completed for ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Error cleaning up logged out session ${clientId}: ${error.message}`);
            // Don't throw here, as logout cleanup is best-effort
        }
    }

    async restoreSpecificSession(clientId: string, userId: string, emit?: (event: string, data: any) => void): Promise<boolean> {
        try {
            this.logger.log(`🔄 Restoring specific session ${clientId} with events...`);
            
            const client = await this.sessionManager.createSession(clientId, userId, true);
            
            // Set up full event handlers if emit function is provided
            if (emit) {
                this.eventHandler.setupEventHandlers(client, clientId, emit, userId);
            } else {
                this.setupRestoredSessionEvents(client, clientId);
            }
            
            // Initialize the client
            await client.initialize();
            
            this.logger.log(`✅ Session ${clientId} restored with events`);
            return true;
        } catch (error) {
            this.logger.error(`❌ Failed to restore specific session ${clientId}: ${error.message}`);
            
            try {
                await this.fileManager.cleanupSessionFiles(clientId, false); // Non-force cleanup for failed restore
            } catch (cleanupError) {
                this.logger.warn(`Warning: Could not cleanup files for failed specific restore ${clientId}: ${cleanupError.message}`);
            }
            
            this.sessionManager.removeSession(clientId);
            return false;
        }
    }
}
