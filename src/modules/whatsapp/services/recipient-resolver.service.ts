// src/whatsapp/services/recipient-resolver.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { ContactsService } from '../../contacts/contacts.service';
import { GroupsService } from '../../groups/groups.service';

@Injectable()
export class RecipientResolverService {
    private readonly logger = new Logger(RecipientResolverService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly contactsService: ContactsService,
        private readonly groupsService: GroupsService,
    ) { }

    async resolveRecipients(to: string[], clientId: string): Promise<string[]> {
        this.logger.log(`🔍 Resolving recipients for clientId: ${clientId}`);

        const account = await this.getAccountByClientId(clientId);
        const accountId = account._id.toString();
        const resolvedNumbersSet = new Set<string>();

        for (const item of to) {
            if (this.isValidObjectId(item)) {
                await this.resolveObjectIdRecipient(item, accountId, resolvedNumbersSet);
            } else {
                resolvedNumbersSet.add(item);
            }
        }

        const resolvedNumbers = Array.from(resolvedNumbersSet);
        this.logger.log(`✅ Resolved numbers: ${JSON.stringify(resolvedNumbers)}`);
        return resolvedNumbers;
    }

    private async getAccountByClientId(clientId: string): Promise<AccountDocument> {
        const account = await this.accountModel.findOne({ clientId }).exec();
        if (!account) {
            throw new NotFoundException(`No account found for clientId: ${clientId}`);
        }
        return account;
    }

    private async resolveObjectIdRecipient(
        item: string,
        accountId: string,
        resolvedNumbersSet: Set<string>
    ): Promise<void> {
        // Try group first
        const group = await this.groupsService.findGroupById(item, accountId).catch(() => null);
        if (group) {
            await this.resolveGroupContacts(group, accountId, resolvedNumbersSet);
            return;
        }

        // Try contact
        const contact = await this.contactsService.findContactById(item, accountId).catch(() => null);
        if (contact) {
            resolvedNumbersSet.add(contact.phone_number);
            return;
        }

        this.logger.warn(`⚠️ No group or contact found for ObjectId ${item}`);
    }

    private async resolveGroupContacts(
        group: any,
        accountId: string,
        resolvedNumbersSet: Set<string>
    ): Promise<void> {
        if (!Array.isArray(group.contacts)) return;

        for (const contactItem of group.contacts) {
            if (typeof contactItem === 'object' && contactItem?.phone_number) {
                resolvedNumbersSet.add(contactItem.phone_number);
            } else if (this.isValidObjectId(contactItem)) {
                const contact = await this.contactsService
                    .findContactById(contactItem.toString(), accountId)
                    .catch(() => null);
                if (contact) {
                    resolvedNumbersSet.add(contact.phone_number);
                }
            }
        }
    }

    private isValidObjectId(id: string | Types.ObjectId): boolean {
        if (id instanceof Types.ObjectId) return true;
        if (typeof id === 'string') return /^[a-fA-F0-9]{24}$/.test(id);
        return false;
    }
}
