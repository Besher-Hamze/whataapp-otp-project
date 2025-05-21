import { Controller, Post, Body, Get, Param, BadRequestException, UseGuards } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { UserDocument } from '../users/schema/users.schema';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId, GetWhatsappAccountId } from 'src/common/decorators';
import { NewMessageDto } from './dto/message.dto';
import { AccountsService } from '../accounts/accounts.service';


@UseGuards(JwtGuard)
@Controller('whatsapp')
export class WhatsAppController {
  
  constructor(
    private readonly whatsappService: WhatsAppService,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    private readonly accountsService: AccountsService,
  ) {}

  @Get('start')
  async startSession() {
    return {
      message:
        'Use WebSocket at /whatsapp/start and emit "start-session" to initiate session.',
    };
  }

 @Post('send-message')
  async sendMessage(
    @Body() body: NewMessageDto,
    @GetUserId() userId : string,
    @GetWhatsappAccountId() accountId: string,
  ) {
    try {
      const client = await this.accountsService.findClientIdByAccountId(accountId , userId);
      if (!client) {
        throw new BadRequestException('Account ID not found for the given accountId');
      }
      return await this.whatsappService.sendMessage(
        client.clientId,
        body.to,
        body.message,
      );
    } catch (error) {
        throw error;
    }
  }

  @Get('session-count')
  getSessionCount() {
    return {
      count: this.whatsappService.getActiveSessionCount(),
      sessions: this.whatsappService.getAllSessions(),
    };
  }

  // 🔹 List all WhatsApp-linked accounts
  @Get('accounts')
  async getAccounts() {
    return await this.accountModel.find().lean();
  }

  // 🔹 Get account by ID
  @Get('accounts/:id')
  async getAccountById(@Param('id') id: string) {
    return await this.accountModel.findById(id).lean();
  }
}


