import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';

@Injectable()
export class MessageHandlerService {
    private readonly logger = new Logger(MessageHandlerService.name);
    private readonly messageHandlers: Array<(message: any, accountId: string) => Promise<void>> = [];
    private readonly unreadMessages = new Map<string, { clientId: string, from: string }>();

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    ) { }

    registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>): void {
        this.logger.log('📝 Registering new message handler');
        this.messageHandlers.push(handler);
    }

    async handleIncomingMessage(message: Message, clientId: string): Promise<void> {
        try {
            if (message.from.endsWith('@broadcast') || message.fromMe) return;

            const account = await this.accountModel.findOne({ clientId }, { _id: 1, user: 1 }).lean().exec();
            if (!account) return;

            const accountId = account._id.toString();
            const sender = message.from.split('@')[0];

            this.unreadMessages.set(message.id.id, { clientId, from: sender });

            await Promise.allSettled(
                this.messageHandlers.map(handler =>
                    handler({ from: sender, body: message.body || '' }, accountId) // Pass message.body
                        .catch(err => this.logger.error(`Handler error: ${err.message}`))
                )
            );
        } catch (error) {
            this.logger.error(`❌ Message handling error: ${error.message}`);
        }
    }

    getUnreadMessages(): Map<string, { clientId: string, from: string }> {
        return new Map(this.unreadMessages);
    }

    clearUnreadMessage(messageId: string): void {
        this.unreadMessages.delete(messageId);
    }
}