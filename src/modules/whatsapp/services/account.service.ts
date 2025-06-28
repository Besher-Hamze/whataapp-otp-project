// src/whatsapp/services/account.service.ts
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { AuthService } from '../../auth/auth.service';
import { CleanupService } from './cleanup.service';
import { SessionManagerService } from './session-manager.service';
import { Client } from 'whatsapp-web.js';
import { Contact, ContactDocument } from 'src/modules/contacts/schema/contacts.schema';
import { Group, GroupDocument } from 'src/modules/groups/schema/groups.schema';
import { Rule, RuleDocument } from 'src/modules/rules/schema/rules.schema';
import { Template, TemplateDocument } from 'src/modules/templates/schema/template.schema';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
        @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
        @InjectModel(Rule.name) private ruleModel: Model<RuleDocument>,
        @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
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
   // Debug: Check matching groups before deletion
      const groupCount = await this.groupModel.countDocuments({ account: accountId }).exec();
      this.logger.debug(`🔍 Found ${groupCount} groups for account ${accountId} before deletion`);
      
      // Perform deletions
      const deletePromises = [
        this.contactModel.deleteMany({ account: accountId }).then(result => {
          this.logger.log(`✅ Deleted ${result.deletedCount} contacts for account ${accountId}`);
          return result;
        }),
        this.groupModel.deleteMany({ account: accountId }).then(result => {
          this.logger.log(`✅ Deleted ${result.deletedCount} groups for account ${accountId}`);
          return result;
        }),
        this.ruleModel.deleteMany({account: accountId }).then(result => {
          this.logger.log(`✅ Deleted ${result.deletedCount} rules for account ${accountId}`);
          return result;
        }),
        this.templateModel.deleteMany({ account: accountId }).then(result => {
          this.logger.log(`✅ Deleted ${result.deletedCount} templates for account ${accountId}`);
          return result;
        }),
        this.accountModel.deleteOne({ _id: accountId }).then(result => {
          this.logger.log(`✅ Deleted account ${accountId}`);
          return result;
        }),
      ];

      await this.authService.removeAccountFromTokens(userId, accountId);
      await Promise.all(deletePromises);

      this.logger.log(`✅ Deleted account and all related data for ${accountId}`);
    } catch (error) {
      this.logger.error(`❌ Error deleting account ${accountId}: ${error.message}`, error.stack);
      throw new HttpException(`Failed to delete account: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

    async getUserAccounts(userId: string): Promise<AccountDocument[]> {
        return await this.accountModel.find({ user: userId }).lean().exec();
    }

    async findAccountByClientId(clientId: string): Promise<AccountDocument | null> {
        return await this.accountModel.findOne({ clientId }).exec();
    }
}
