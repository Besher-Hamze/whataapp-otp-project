// src/whatsapp/services/file-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileManagerService {
    private readonly logger = new Logger(FileManagerService.name);
    private readonly pendingDeletions = new Set<string>();

    async cleanupSessionFiles(clientId: string, force: boolean = false): Promise<void> {
        const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);
        
        // Prevent duplicate cleanup attempts
        if (this.pendingDeletions.has(clientId)) {
            this.logger.warn(`🔄 Cleanup already in progress for ${clientId}`);
            return;
        }
        
        this.pendingDeletions.add(clientId);
        
        try {
            if (!fs.existsSync(sessionPath)) {
                this.logger.log(`📁 Session path does not exist for ${clientId}`);
                return;
            }

            // Wait a bit for any file handles to be released
            await new Promise(resolve => setTimeout(resolve, 2000));

            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    if (force && attempt === 1) {
                        // Try to forcefully close any Chrome processes first
                        await this.forceCloseChrome(clientId);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                    // Try different deletion strategies
                    await this.deleteWithStrategy(sessionPath, attempt);
                    
                    this.logger.log(`🗑️ Session files deleted for ${clientId} on attempt ${attempt}`);
                    break;
                    
                } catch (error) {
                    this.logger.error(`❌ Attempt ${attempt} failed to delete session files for ${clientId}: ${error.message}`);
                    
                    if (attempt === 5) {
                        if (error.code === 'EPERM' || error.code === 'EBUSY') {
                            // Schedule delayed deletion
                            this.scheduleDelayedDeletion(sessionPath, clientId);
                            this.logger.warn(`⏰ Scheduled delayed deletion for ${clientId} due to file locks`);
                        } else {
                            throw error;
                        }
                    } else {
                        // Progressive delay between attempts
                        const delay = attempt * 2000 + Math.random() * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
        } finally {
            this.pendingDeletions.delete(clientId);
        }
    }

    private async deleteWithStrategy(sessionPath: string, attempt: number): Promise<void> {
        switch (attempt) {
            case 1:
                // Standard deletion
                rmSync(sessionPath, { recursive: true, force: true });
                break;
                
            case 2:
                // Delete individual files first, then directories
                await this.deleteFilesRecursively(sessionPath);
                break;
                
            case 3:
                // Try to change permissions first
                await this.makeWritableRecursively(sessionPath);
                rmSync(sessionPath, { recursive: true, force: true });
                break;
                
            case 4:
                // Use maxRetries option
                rmSync(sessionPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
                break;
                
            case 5:
                // Final attempt with maximum force
                await this.forceDeleteDirectory(sessionPath);
                break;
                
            default:
                rmSync(sessionPath, { recursive: true, force: true });
        }
    }

    private async deleteFilesRecursively(dirPath: string): Promise<void> {
        if (!fs.existsSync(dirPath)) return;
        
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                await this.deleteFilesRecursively(itemPath);
                try {
                    fs.rmdirSync(itemPath);
                } catch (error) {
                    // Ignore directory deletion errors, try later
                }
            } else {
                try {
                    fs.unlinkSync(itemPath);
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        throw error;
                    }
                }
            }
        }
        
        // Try to remove the main directory
        try {
            fs.rmdirSync(dirPath);
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
                throw error;
            }
        }
    }

    private async makeWritableRecursively(dirPath: string): Promise<void> {
        if (!fs.existsSync(dirPath)) return;
        
        try {
            fs.chmodSync(dirPath, 0o777);
            
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                
                fs.chmodSync(itemPath, 0o777);
                
                if (stat.isDirectory()) {
                    await this.makeWritableRecursively(itemPath);
                }
            }
        } catch (error) {
            // Ignore permission errors, they might not be critical
            this.logger.debug(`Permission change failed: ${error.message}`);
        }
    }

    private async forceDeleteDirectory(dirPath: string): Promise<void> {
        if (process.platform === 'win32') {
            // Use Windows-specific commands
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            try {
                // Remove read-only attributes and force delete
                await execAsync(`attrib -R "${dirPath}\\*.*" /S /D`);
                await execAsync(`rmdir "${dirPath}" /S /Q`);
            } catch (error) {
                // Fallback to Node.js method
                rmSync(dirPath, { recursive: true, force: true });
            }
        } else {
            // Unix/Linux systems
            rmSync(dirPath, { recursive: true, force: true });
        }
    }

    private async forceCloseChrome(clientId: string): Promise<void> {
        if (process.platform === 'win32') {
            try {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                // Kill Chrome processes that might be holding file handles
                await execAsync('taskkill /F /IM chrome.exe /T').catch(() => {});
                await execAsync('taskkill /F /IM chromium.exe /T').catch(() => {});
                
                this.logger.debug(`🔨 Attempted to close Chrome processes for ${clientId}`);
            } catch (error) {
                this.logger.debug(`Could not force close Chrome: ${error.message}`);
            }
        }
    }

    private scheduleDelayedDeletion(sessionPath: string, clientId: string): void {
        // Schedule deletion after a longer delay
        setTimeout(async () => {
            try {
                if (fs.existsSync(sessionPath)) {
                    await this.forceDeleteDirectory(sessionPath);
                    this.logger.log(`🗑️ Delayed deletion successful for ${clientId}`);
                }
            } catch (error) {
                this.logger.error(`❌ Delayed deletion failed for ${clientId}: ${error.message}`);
                // Schedule one more attempt
                setTimeout(() => {
                    try {
                        if (fs.existsSync(sessionPath)) {
                            fs.rmSync(sessionPath, { recursive: true, force: true });
                            this.logger.log(`🗑️ Final deletion attempt successful for ${clientId}`);
                        }
                    } catch (finalError) {
                        this.logger.error(`❌ Final deletion attempt failed for ${clientId}: ${finalError.message}`);
                    }
                }, 30000); // Try again after 30 seconds
            }
        }, 10000); // Initial delay of 10 seconds
    }

    async cleanupCacheFiles(): Promise<void> {
        const cachePath = path.join(process.cwd(), '.wwebjs_cache');
        try {
            if (fs.existsSync(cachePath)) {
                rmSync(cachePath, { recursive: true, force: true });
                this.logger.log(`🗑️ Cache files deleted for ${cachePath}`);
                fs.mkdirSync(cachePath, { recursive: true });
            }
        } catch (error) {
            this.logger.error(`❌ Failed to delete cache files for ${cachePath}: ${error.message}`);
            throw error;
        }
    }

    isValidSession(sessionPath: string): boolean {
        try {
            const stats = fs.statSync(sessionPath);
            if (!stats.isDirectory()) return false;

            const files = fs.readdirSync(sessionPath);
            return files.length > 0;
        } catch (error) {
            return false;
        }
    }

    loadSessionFolders(): string[] {
        const sessionDir = path.join(process.cwd(), '.wwebjs_auth');

        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            return [];
        }

        return fs.readdirSync(sessionDir).filter(folder => folder.startsWith('session-'));
    }
}
