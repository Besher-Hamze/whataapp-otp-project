import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from './schema/account.schema';
import { Model } from 'mongoose';

@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account.name) private accountModel: Model<AccountDocument>) {}
  private readonly logger = new Logger(AccountsService.name);
  async create(createAccountDto: CreateAccountDto & { user: string }) {
    const existingAccount = await this.accountModel.findOne({
      $or: [{ phone_number: createAccountDto.phone_number }],
    });

    if (existingAccount) {
      throw new ConflictException('Phone Number already exists');
    }
    const newAccount = await this.accountModel.create({
      name: createAccountDto.name,
      phone_number: createAccountDto.phone_number,
      user: createAccountDto.user,
    });
    return newAccount;
  }

  async findAllAccounts(): Promise<AccountDocument[]> { // Update return type
    return this.accountModel.find().exec();
  }

  async findAccountById(id: string): Promise<AccountDocument | null> { // Update return type
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

  async updateAccount(id: string, updateAccountDto: UpdateAccountDto): Promise<AccountDocument | null> { // Update return type
    const existingAccount = await this.accountModel.findById(id).exec();
    if (!existingAccount) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }

    const duplicateAccount = await this.accountModel.findOne({
      $or: [{ phone_number: updateAccountDto.phone_number }],
      _id: { $ne: existingAccount._id },
    }).exec();

    if (duplicateAccount) {
      throw new ConflictException('Phone number already exists');
    }

    const updatedAccount = await this.accountModel
      .findByIdAndUpdate(
        id,
        {
          ...updateAccountDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedAccount;
  }

  async deleteAccount(id: string): Promise<void> {
    const result = await this.accountModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }
  async findAccountsByUser(userId: string): Promise<AccountDocument[]> {
    this.logger.log(`Starting findAccountsByUser for userId: ${userId}`);
    try {
      this.logger.debug(`Querying accounts for userId: ${userId}`);
      const accounts = await this.accountModel.find({ user: userId }).exec();
      if (!accounts || accounts.length === 0) {
        this.logger.warn(`No accounts found for userId: ${userId}`);
        throw new NotFoundException(`No accounts found for user "${userId}"`);
      }
      this.logger.log(`Found ${accounts.length} account(s) for userId: ${userId}`);
      return accounts;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid user ID "${userId}"`);
      }
      throw error;
    }
  }
}