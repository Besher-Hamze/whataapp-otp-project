// src/whatsapp/services/file-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileManagerService {
    private readonly logger = new Logger(FileManagerService.name);

    async cleanupSessionFiles(clientId: string): Promise<void> {
        const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (fs.existsSync(sessionPath)) {
                    rmSync(sessionPath, { recursive: true, force: true });
                    this.logger.log(`🗑️ Session files deleted for ${clientId} on attempt ${attempt}`);
                    break;
                }
            } catch (error) {
                this.logger.error(`❌ Attempt ${attempt} failed to delete session files for ${clientId}: ${error.message}`);
                if (attempt === 3) throw error;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
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
            return files.length > 0 && files.some(file => file === 'session.json');
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
