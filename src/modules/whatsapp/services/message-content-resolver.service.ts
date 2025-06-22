// src/whatsapp/services/message-content-resolver.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { TemplatesService } from '../../templates/templates.service';

@Injectable()
export class MessageContentResolverService {
    private readonly logger = new Logger(MessageContentResolverService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly templatesService: TemplatesService,
    ) { }

    async resolveContent(message: string, clientId: string): Promise<string> {
        this.logger.debug(`🔍 Resolving message content for clientId: ${clientId}`);

        if (!Types.ObjectId.isValid(message)) {
            return message;
        }

        try {
            const account = await this.accountModel.findOne({ clientId }).exec();
            if (!account) {
                throw new NotFoundException(`No account found for clientId: ${clientId}`);
            }

            const accountId = account._id.toString();
            const template = await this.templatesService.findById(message, accountId);

            this.logger.debug(`🔍 Using template ${message} content: ${template.content}`);
            return template.content;

        } catch (error) {
            if (error instanceof NotFoundException) {
                this.logger.warn(`⚠️ Template "${message}" not found, falling back to raw message`);
                return message;
            }
            throw error;
        }
    }
}
