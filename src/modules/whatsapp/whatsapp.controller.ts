import { Controller, Post, Body, Get, Param, BadRequestException, UseGuards, Query } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
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
  ) { }

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
    @GetUserId() userId: string,
    @GetWhatsappAccountId() accountId: string,
    @Query('delay') delay?: number, // Optional query parameter for delay in ms
  ) {
    try {
      const client = await this.accountsService.findClientIdByAccountId(accountId, userId);
      if (!client) {
        throw new BadRequestException('Account ID not found for the given accountId');
      }

      // Parse and validate delay parameter
      let messageDelay = 5000; // Default 5 seconds
      if (delay) {
        const parsedDelay = parseInt(delay.toString(), 10);
        if (!isNaN(parsedDelay) && parsedDelay >= 1000 && parsedDelay <= 60000) {
          messageDelay = parsedDelay;
        } else {
          throw new BadRequestException('Delay must be between 1000ms and 60000ms (1-60 seconds)');
        }
      }

      return await this.whatsappService.sendMessage(
        client.clientId,
        body.to,
        body.message,
        messageDelay,
      ) as any;
    } catch (error) {
      throw error;
    }
  }

  @Get('session-count')
  getSessionCount(@GetUserId() userId: string) {
    return {
      count: this.whatsappService.getActiveSessionCount(),
      sessions: this.whatsappService.getAllSessions(),
    };
  }

  @Get('accounts')
  async getAccounts(@GetUserId() userId: string) {
    // Only return accounts for the current user
    return await this.accountModel.find({ user: userId }).lean();
  }

  @Get('accounts/:id')
  async getAccountById(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    const account = await this.accountModel.findOne({
      _id: id,
      user: userId
    }).lean();

    if (!account) {
      throw new BadRequestException('Account not found or does not belong to user');
    }

    // Add status info about whether client is ready
    if (account.clientId) {
      account['clientReady'] = this.whatsappService.isClientReady(account.clientId);
    } else {
      account['clientReady'] = false;
    }

    return account;
  }
}
