import { Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { FileManagerService } from './file-manager.service';
import { ProtocolErrorHandlerService } from './protocol-error-handler.service';
import { Client } from 'whatsapp-web.js';

export interface CleanupOptions {
    /** Delete `.wwebjs_auth` — only for logout / account delete. Default: false */
    deleteAuthFiles?: boolean;
    forceCacheCleanup?: boolean;
}

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);
    private readonly pendingCleanups = new Set<string>();
    private readonly SESSION_TIMEOUT = 100 * 24 * 60 * 60 * 1000;

    constructor(
        private readonly sessionManager: SessionManagerService,
        private readonly fileManager: FileManagerService,
        private readonly protocolErrorHandler: ProtocolErrorHandlerService,
    ) { }

    /**
     * Stop Puppeteer / in-memory client only. Keeps `.wwebjs_auth` on disk so the session can be restored.
     */
    async releaseClientMemory(clientId: string, reason: string): Promise<void> {
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState) {
            return;
        }

        this.logger.log(`🔄 Releasing in-memory client ${clientId} (auth files preserved): ${reason}`);

        this.sessionManager.updateClientState(clientId, {
            isReady: false,
            isSending: false,
        });

        try {
            await this.destroyClientSafely(clientState.client, clientId);
        } catch (error: any) {
            this.logger.warn(`⚠️ Error releasing client ${clientId}: ${error?.message}`);
        }

        this.sessionManager.removeSession(clientId);
    }

    async cleanupClient(clientId: string, reason: string, options: CleanupOptions = {}) {
        try {
            await this.performCleanup(clientId, reason, options);
        } catch (error: any) {
            this.logger.error(`❌ Cleanup failed for ${clientId}, but continuing: ${error?.message}`);
        }
    }

    private async performCleanup(clientId: string, reason: string, options: CleanupOptions) {
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState) {
            this.logger.warn(`Client state for ${clientId} not found during cleanup`);
            return;
        }

        const deleteAuthFiles = options.deleteAuthFiles ?? (
            reason.toLowerCase().includes('logout') ||
            reason.toLowerCase().includes('deleted')
        );

        this.logger.log(
            `🧹 Cleaning up client ${clientId}: ${reason} (deleteAuthFiles=${deleteAuthFiles})`,
        );

        this.sessionManager.updateClientState(clientId, {
            isReady: false,
            isSending: false,
        });

        try {
            await this.destroyClientSafely(clientState.client, clientId);
            this.logger.log(`✅ Client ${clientId} destroyed successfully`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Error destroying client ${clientId}: ${error?.message}`);
        }

        if (deleteAuthFiles) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            try {
                const forceFileCleanup = options.forceCacheCleanup ?? true;
                await this.fileManager.cleanupSessionFiles(clientId, forceFileCleanup);
                this.logger.log(`🗑️ Session auth files deleted for ${clientId}`);
            } catch (error: any) {
                this.logger.warn(`⚠️ Failed to delete session files for ${clientId}: ${error?.message}`);
            }

            if (options.forceCacheCleanup || this.sessionManager.getActiveSessionCount() === 0) {
                try {
                    await this.fileManager.cleanupCacheFiles();
                } catch (err: any) {
                    this.logger.warn(`Error cleaning cache files: ${err?.message}`);
                }
            }
        } else {
            this.logger.log(`💾 Auth files kept for ${clientId} on disk`);
        }

        this.sessionManager.removeSession(clientId);
        this.logger.log(`✅ Cleanup completed for ${clientId}`);
    }

    scheduleCleanup(
        clientId: string,
        reason: string,
        delayMs: number = 5000,
        deleteAuthFiles: boolean = false,
    ) {
        if (this.pendingCleanups.has(clientId)) return;
        this.pendingCleanups.add(clientId);

        this.logger.log(`🕒 Scheduling cleanup for ${clientId} in ${delayMs}ms: ${reason}`);
        setTimeout(async () => {
            try {
                await this.cleanupClient(clientId, reason, {
                    deleteAuthFiles,
                    forceCacheCleanup: deleteAuthFiles,
                });
            } catch (error: any) {
                this.logger.error(`❌ Cleanup failed for ${clientId}: ${error?.message}`);
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
            this.logger.log(`🕒 Releasing inactive in-memory session ${clientId} (auth files kept)`);
            void this.releaseClientMemory(clientId, 'Inactive session timeout');
        });

        if (inactiveClientIds.length > 0) {
            this.logger.log(`🧹 Released ${inactiveClientIds.length} inactive in-memory sessions`);
        }
    }

    private async destroyClientSafely(client: Client, clientId: string): Promise<void> {
        return new Promise(async (resolve) => {
            const destroyTimeout = setTimeout(() => {
                this.logger.warn(`⏰ Client destruction timeout for ${clientId}, forcing completion`);
                resolve();
            }, 8000);

            try {
                const browser = (client as any).pupBrowser;
                if (browser) {
                    await this.protocolErrorHandler.safeExecute(async () => {
                        const isConnected = await this.protocolErrorHandler.safeExecute(
                            async () => browser.isConnected && browser.isConnected(),
                            `BrowserConnection-${clientId}`,
                        );

                        if (!isConnected) {
                            return;
                        }

                        await this.protocolErrorHandler.safeRace([
                            this.closeBrowserPages(browser, clientId),
                        ], 2000, `BrowserPages-${clientId}`);

                        await this.protocolErrorHandler.safeRace([
                            browser.close(),
                        ], 2000, `BrowserClose-${clientId}`);
                    }, `BrowserCleanup-${clientId}`);
                }

                await this.protocolErrorHandler.safeRace([
                    client.destroy(),
                ], 3000, `ClientDestroy-${clientId}`);

                clearTimeout(destroyTimeout);
                resolve();
            } catch (error) {
                clearTimeout(destroyTimeout);
                this.protocolErrorHandler.handleProtocolError(error, `ClientDestroyFinal-${clientId}`, false);
                await this.forceKillBrowserProcess((client as any).pupBrowser).catch(() => {});
                resolve();
            }
        });
    }

    private async closeBrowserPages(browser: any, clientId: string): Promise<void> {
        return this.protocolErrorHandler.safeExecute(async () => {
            const pages = await browser.pages();
            if (pages && pages.length > 0) {
                await Promise.all(
                    pages.map((page: any) =>
                        this.protocolErrorHandler.safeRace([
                            page.close(),
                        ], 1000, `PageClose-${clientId}`),
                    ),
                );
            }
        }, `GetBrowserPages-${clientId}`);
    }

    private async forceKillBrowserProcess(browser: any): Promise<void> {
        if (!browser) return;

        try {
            const proc = browser.process();
            if (proc) {
                proc.kill('SIGKILL');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                await new Promise(resolve => {
                    exec('taskkill /F /IM chrome.exe /T', () => resolve(null));
                });
                await new Promise(resolve => {
                    exec('taskkill /F /IM chromium.exe /T', () => resolve(null));
                });
            }
        } catch (error: any) {
            this.logger.debug(`Could not force kill browser process: ${error?.message}`);
        }
    }
}
