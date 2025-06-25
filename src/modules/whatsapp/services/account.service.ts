// src/whatsapp/services/account.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { AuthService } from '../../auth/auth.service';
import { CleanupService } from './cleanup.service';
import { SessionManagerService } from './session-manager.service';
import { Client } from 'whatsapp-web.js';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly authService: AuthService,
        private readonly cleanupService: CleanupService, // Injected
        private readonly sessionManager: SessionManagerService
    ) { }

    async handleAccountReady(
        phoneNumber: string,
        name: string,
        clientId: string,
        userId: string
    ): Promise<void> {
        const existingAccount = await this.accountModel.findOne({ phone_number: phoneNumber }).lean().exec();

        if (existingAccount) {
            if (existingAccount.user.toString() !== userId) {
                throw new Error(`Phone number ${phoneNumber} is already in use by another user.`);
            }

            if (existingAccount.clientId !== clientId) {
                await this.accountModel.updateOne(
                    { _id: existingAccount._id },
                    { 
                        clientId, 
                        status: 'ready',
                        'sessionData.isAuthenticated': true,
                        'sessionData.lastConnected': new Date(),
                        'sessionData.authState': 'authenticated',
                        'sessionData.sessionValid': true
                    }
                ).exec();
                this.logger.log(`🔄 Updated account ${existingAccount._id} with new clientId ${clientId}`);
            } else {
                // Update session data for existing account with same clientId
                await this.accountModel.updateOne(
                    { _id: existingAccount._id },
                    { 
                        status: 'ready',
                        'sessionData.isAuthenticated': true,
                        'sessionData.lastConnected': new Date(),
                        'sessionData.authState': 'authenticated',
                        'sessionData.sessionValid': true
                    }
                ).exec();
                this.logger.log(`✅ Updated session data for existing account ${existingAccount._id}`);
            }
        } else {
            await this.accountModel.create({
                name,
                phone_number: phoneNumber,
                user: userId,
                clientId,
                status: 'ready',
                sessionData: {
                    isAuthenticated: true,
                    lastConnected: new Date(),
                    authState: 'authenticated',
                    sessionValid: true
                },
                created_at: new Date(),
            });
            this.logger.log(`✅ Created new account for ${phoneNumber} with clientId ${clientId}`);
        }
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

    async deleteAccountOnLogout(accountId: string): Promise<void> {
        const account = await this.accountModel.findById(accountId).exec();
        if (account) {
            const userId = account.user.toString();
            await this.authService.removeAccountFromTokens(userId, accountId);
            await this.accountModel.deleteOne({ _id: accountId }).exec();
            this.logger.log(`✅ Account ${accountId} deleted on logout`);
        }
    }

    async getUserAccounts(userId: string): Promise<AccountDocument[]> {
        return await this.accountModel.find({ user: userId }).lean().exec();
    }

    async findAccountByClientId(clientId: string): Promise<AccountDocument | null> {
        return await this.accountModel.findOne({ clientId }).exec();
    }
}
