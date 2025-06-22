// src/whatsapp/services/account.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { AuthService } from '../../auth/auth.service';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly authService: AuthService,
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
                    { clientId, status: 'active' }
                ).exec();
                this.logger.log(`🔄 Updated clientId for account ${existingAccount._id} to ${clientId}`);
            }
        } else {
            await this.accountModel.create({
                name,
                phone_number: phoneNumber,
                user: userId,
                clientId,
                status: 'active',
                created_at: new Date(),
            });
            this.logger.log(`✅ Created new account for ${phoneNumber}`);
        }
    }

    async handleLogout(clientId: string): Promise<void> {
        const account = await this.accountModel.findOne({ clientId }).exec();
        if (account) {
            const accountId = account._id.toString();
            await this.deleteAccountOnLogout(accountId);
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
