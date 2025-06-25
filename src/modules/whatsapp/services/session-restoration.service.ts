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
            const sessionFolders = this.fileManager.loadSessionFolders();

            for (const folder of sessionFolders) {
                const clientId = folder.replace('session-', '');
                const sessionPath = path.join(process.cwd(), '.wwebjs_auth', folder);

                if (!this.fileManager.isValidSession(sessionPath)) {
                    await this.fileManager.cleanupSessionFiles(clientId);
                    continue;
                }

                const account = await this.accountModel.findOne({ clientId }).lean().exec();
                if (!account || account.status !== 'active') continue;

                await this.restoreSession(clientId, account.user.toString());
            }
        } catch (error) {
            this.logger.error(`❌ Failed to load sessions: ${error.message}`);
        }
    }

    private async restoreSession(clientId: string, userId: string) {
        try {
            const client = await this.sessionManager.createSession(clientId, userId);
            // this.eventHandler.setupEventHandlers(client, clientId, () => { }, userId);
            
            await client.initialize();
            this.logger.log(`✅ Restored session ${clientId} for user ${userId}`);
        } catch (error) {
            this.logger.error(`❌ Failed to restore session ${clientId}: ${error.message}`);
            await this.fileManager.cleanupSessionFiles(clientId);
            this.sessionManager.removeSession(clientId);
        }
    }
}
