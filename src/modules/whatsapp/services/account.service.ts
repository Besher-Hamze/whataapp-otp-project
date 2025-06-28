// src/whatsapp/services/account.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { AuthService } from '../../auth/auth.service';
import { CleanupService } from './cleanup.service';
import { SessionManagerService } from './session-manager.service';
import { Client } from 'whatsapp-web.js';
import { ContactDocument } from 'src/modules/contacts/schema/contacts.schema';
import { GroupDocument } from 'src/modules/groups/schema/groups.schema';
import { RuleDocument } from 'src/modules/rules/schema/rules.schema';
import { TemplateDocument } from 'src/modules/templates/schema/template.schema';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        @InjectModel(Account.name) private contactModel: Model<ContactDocument>,
        @InjectModel(Account.name) private groupModel: Model<GroupDocument>,
        @InjectModel(Account.name) private ruleModel: Model<RuleDocument>,
        @InjectModel(Account.name) private templateModel: Model<TemplateDocument>,
        private readonly authService: AuthService,
        private readonly cleanupService: CleanupService, // Injected
        private readonly sessionManager: SessionManagerService
    ) { }

    // account.service.ts
async handleAccountReady(phoneNumber: string, name: string, clientId: string, userId: string): Promise<AccountDocument> {
  // ... your existing logic
  const account = await this.accountModel.findOneAndUpdate(
    { clientId },
    {
      phoneNumber,
      name,
      clientId,
      user: userId,
      updatedAt: new Date()
    },
    { new: true, upsert: true }
  );

  return account;
}


    async handleLogout(clientId: string, client: Client): Promise<void> { // Add client parameter
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState || !clientState.client) {
            this.logger.warn(`Client state or client for ${clientId} not found during logout`);
            return;
        }

        this.logger.log(`🔒 ${clientId} detected as logged out`);
        
        try {
            // Remove all listeners immediately to prevent any further events
            client.removeAllListeners();
            
            // Give time for any pending operations to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Use cleanup service for proper browser and file cleanup
            await this.cleanupService.cleanupClient(clientId, 'Logout', true); // Force cleanup
            this.logger.log(`✅ Client ${clientId} destroyed and cleaned up`);

            const account = await this.accountModel.findOne({ clientId }).exec();
            if (account) {
                const accountId = account._id.toString();
                await this.deleteAccountOnLogout(accountId);
                this.logger.log(`✅ Account ${accountId} deleted on logout`);
            }
        } catch (error) {
            this.logger.error(`❌ Error during logout for ${clientId}: ${error.message}`);
            // Don't throw here, as logout cleanup should be best-effort
        }
    }
    async findAccountById(id: string): Promise<AccountDocument | null> {
        try {
          const account = await this.accountModel.findById(id).exec();
          if (!account) {
            throw new NotFoundException(`Account with ID "${id}" not found`);
          }
          return account;
        } catch (error) {
          if (error.name === 'CastError') {
            throw new NotFoundException(`Invalid Account ID "${id}"`);
          }
          throw error;
        }
      }

    async deleteAccountOnLogout(accountId: string): Promise<void> {
    try {
        const account = await this.accountModel.findById(accountId).exec();
        if (!account) {
            this.logger.warn(`⚠️ Account ${accountId} not found`);
            return;
        }

        const userId = account.user.toString();

        await this.authService.removeAccountFromTokens(userId, accountId);

        await Promise.all([
            this.accountModel.deleteOne({ _id: accountId }).exec(),
            this.contactModel.deleteMany({ accountId }).exec(),
            this.groupModel.deleteMany({ accountId }).exec(),
            this.ruleModel.deleteMany({ accountId }).exec(),
            this.templateModel.deleteMany({ accountId }).exec(),
        ]);

        this.logger.log(`✅ Deleted account and all related data for ${accountId}`);
    } catch (error) {
        this.logger.error(`❌ Error deleting account ${accountId}: ${error.message}`, error.stack);
        throw error; // Rethrow if you want upstream handling
    }
}

    async getUserAccounts(userId: string): Promise<AccountDocument[]> {
        return await this.accountModel.find({ user: userId }).lean().exec();
    }

    async findAccountByClientId(clientId: string): Promise<AccountDocument | null> {
        return await this.accountModel.findOne({ clientId }).exec();
    }
}
