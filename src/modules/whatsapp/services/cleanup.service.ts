import { Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { FileManagerService } from './file-manager.service';
import { Client } from 'whatsapp-web.js';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);
    private readonly pendingCleanups = new Set<string>();
    private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    constructor(
        private readonly sessionManager: SessionManagerService,
        private readonly fileManager: FileManagerService,
    ) { }

    async cleanupClient(clientId: string, reason: string, forceCacheCleanup: boolean = false) {
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState) {
            this.logger.warn(`Client state for ${clientId} not found during cleanup`);
            return;
        }

        this.logger.log(`🧹 Cleaning up client ${clientId}: ${reason}`);

        this.sessionManager.updateClientState(clientId, {
            isReady: false,
            isSending: false,
        });

        try {
            await this.destroyClientSafely(clientState.client, clientId);
        } catch (error) {
            this.logger.error(`❌ Error destroying client ${clientId}: ${error.message}`);
        }

        await this.fileManager.cleanupSessionFiles(clientId);

        if (forceCacheCleanup || this.sessionManager.getActiveSessionCount() === 1) {
            await this.fileManager.cleanupCacheFiles().catch(err =>
                this.logger.warn(`Error cleaning cache files: ${err.message}`)
            );
        }

        this.sessionManager.removeSession(clientId);
        this.logger.log(`✅ Cleanup completed for ${clientId}`);
    }

    scheduleCleanup(clientId: string, reason: string, delayMs: number = 5000) {
        if (this.pendingCleanups.has(clientId)) return;
        this.pendingCleanups.add(clientId);

        this.logger.log(`🕒 Scheduling cleanup for ${clientId} in ${delayMs}ms: ${reason}`);
        setTimeout(async () => {
            try {
                await this.cleanupClient(clientId, reason, true);
            } catch (error) {
                this.logger.error(`❌ Cleanup failed for ${clientId}: ${error.message}`);
            } finally {
                this.pendingCleanups.delete(clientId);
            }
        }, delayMs);
    }

    cleanupInactiveSessions() {
        const now = Date.now();
        const inactiveClientIds: string[] = [];
        const allSessions = this.sessionManager.getAllSessions();

        for (const [clientId, clientState] of allSessions) {
            if (now - clientState.lastActivity > this.SESSION_TIMEOUT && !clientState.isSending) {
                inactiveClientIds.push(clientId);
            }
        }

        inactiveClientIds.forEach(clientId => {
            this.logger.log(`🕒 Cleaning up inactive session ${clientId}`);
            this.scheduleCleanup(clientId, 'Inactive session timeout');
        });

        if (inactiveClientIds.length > 0) {
            this.logger.log(`🧹 Cleaned up ${inactiveClientIds.length} inactive sessions`);
        }
    }

    private async destroyClientSafely(client: Client, clientId: string): Promise<void> {
        return new Promise(async (resolve) => {
            const destroyTimeout = setTimeout(() => {
                this.logger.warn(`⏰ Client destruction timeout for ${clientId}, forcing completion`);
                resolve();
            }, 10000);

            try {
                const browser = (client as any).pupBrowser;
                if (browser) {
                    try {
                        const pages = await browser.pages().catch(() => []);
                        await Promise.all(
                            pages.map((page: any) => page.close().catch(err =>
                                this.logger.debug(`Error closing page: ${err.message}`)
                            ))
                        );
                        await browser.close().catch(err =>
                            this.logger.warn(`Error closing browser: ${err.message}`)
                        );
                    } catch (browserError) {
                        this.logger.warn(`⚠️ Error closing browser manually: ${browserError.message}`);
                    }
                }

                await client.destroy().catch(err =>
                    this.logger.warn(`Error destroying client: ${err.message}`)
                );
                clearTimeout(destroyTimeout);
                resolve();
            } catch (error) {
                clearTimeout(destroyTimeout);
                this.logger.warn(`⚠️ Client destroy error (continuing): ${error.message}`);
                resolve();
            }
        });
    }
}
