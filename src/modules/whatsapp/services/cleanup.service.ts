import { Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { FileManagerService } from './file-manager.service';
import { ProtocolErrorHandlerService } from './protocol-error-handler.service';
import { Client } from 'whatsapp-web.js';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);
    private readonly pendingCleanups = new Set<string>();
    private readonly SESSION_TIMEOUT = 100 * 24 * 60 * 60 * 1000; // 30 minutes

    constructor(
        private readonly sessionManager: SessionManagerService,
        private readonly fileManager: FileManagerService,
        private readonly protocolErrorHandler: ProtocolErrorHandlerService,
    ) { }

    async cleanupClient(clientId: string, reason: string, forceCacheCleanup: boolean = false) {
        // Wrap entire cleanup in try-catch to prevent any crashes
        try {
            await this.performCleanup(clientId, reason, forceCacheCleanup);
        } catch (error) {
            this.logger.error(`❌ Cleanup failed for ${clientId}, but continuing: ${error.message}`);
            // Never throw from here - always complete gracefully
        }
    }

    private async performCleanup(clientId: string, reason: string, forceCacheCleanup: boolean = false) {
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
            this.logger.log(`✅ Client ${clientId} destroyed successfully`);
        } catch (error) {
            this.logger.warn(`⚠️ Error destroying client ${clientId}: ${error.message}`);
            // Continue with cleanup even if destroy fails
        }

        // Wait a bit before attempting file cleanup to ensure all handles are closed
        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
            // Use force cleanup for logout scenarios
            const forceCleanup = reason.toLowerCase().includes('logout') || forceCacheCleanup;
            await this.fileManager.cleanupSessionFiles(clientId, forceCleanup);
            this.logger.log(`🗑️ Session files cleaned for ${clientId}`);
        } catch (error) {
            this.logger.warn(`⚠️ Failed to cleanup session files for ${clientId}: ${error.message}`);
            // Don't throw here, continue with other cleanup
        }

        if (forceCacheCleanup || this.sessionManager.getActiveSessionCount() === 1) {
            try {
                await this.fileManager.cleanupCacheFiles();
                this.logger.log(`🗑️ Cache files cleaned`);
            } catch (err) {
                this.logger.warn(`Error cleaning cache files: ${err.message}`);
            }
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
            }, 8000); // Reduced timeout further

            try {
                // First, try to gracefully close the browser
                const browser = (client as any).pupBrowser;
                if (browser) {
                    await this.protocolErrorHandler.safeExecute(async () => {
                        this.logger.debug(`🌍 Attempting to close browser for ${clientId}`);
                        
                        // Check if browser is still connected before trying to interact
                        const isConnected = await this.protocolErrorHandler.safeExecute(
                            async () => browser.isConnected && browser.isConnected(),
                            `BrowserConnection-${clientId}`
                        );
                        
                        if (!isConnected) {
                            this.logger.debug(`Browser already disconnected for ${clientId}, skipping browser cleanup`);
                            return;
                        }

                        // Try to close pages with timeout protection
                        await this.protocolErrorHandler.safeRace([
                            this.closeBrowserPages(browser, clientId)
                        ], 2000, `BrowserPages-${clientId}`);
                        
                        // Try to close browser with timeout protection
                        await this.protocolErrorHandler.safeRace([
                            browser.close()
                        ], 2000, `BrowserClose-${clientId}`);
                        
                    }, `BrowserCleanup-${clientId}`);
                }

                // Now destroy the WhatsApp client with timeout protection
                await this.protocolErrorHandler.safeRace([
                    client.destroy()
                ], 3000, `ClientDestroy-${clientId}`);
                
                clearTimeout(destroyTimeout);
                this.logger.debug(`✅ Client ${clientId} destruction completed`);
                resolve();
                
            } catch (error) {
                clearTimeout(destroyTimeout);
                this.protocolErrorHandler.handleProtocolError(error, `ClientDestroyFinal-${clientId}`, false);
                
                // Force kill any remaining processes as last resort
                await this.forceKillBrowserProcess((client as any).pupBrowser).catch(() => {});
                resolve(); // Always resolve, never reject
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
                            page.close()
                        ], 1000, `PageClose-${clientId}`)
                    )
                );
            }
        }, `GetBrowserPages-${clientId}`);
    }

    private async forceKillBrowserProcess(browser: any): Promise<void> {
        if (!browser) return;
        
        try {
            // Get the browser process
            const process = browser.process();
            if (process) {
                this.logger.debug(`🔨 Force killing browser process...`);
                process.kill('SIGKILL');
                
                // Wait for process to die
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Additional force kill for Windows
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                await new Promise(resolve => {
                    exec('taskkill /F /IM chrome.exe /T', () => resolve(null));
                });
                await new Promise(resolve => {
                    exec('taskkill /F /IM chromium.exe /T', () => resolve(null));
                });
            }
        } catch (error) {
            this.logger.debug(`Could not force kill browser process: ${error.message}`);
        }
    }
}
