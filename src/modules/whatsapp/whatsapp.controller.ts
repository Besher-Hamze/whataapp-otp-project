import { Controller, Post, Body, Get, Param, BadRequestException, UseGuards } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { UserDocument } from '../users/schema/users.schema';
import { JwtGuard } from 'src/common/guards/jwt.guard';


// @UseGuards(JwtGuard)
@Controller('whatsapp')
export class WhatsAppController {
  
  constructor(
    private readonly whatsappService: WhatsAppService,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
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
    @Body() body: { clientId: string; to: string; message: string },
  ) {
    return await this.whatsappService.sendMessage(
      '',
      body.clientId,
      body.to,
      body.message,
    );
  }

  @Post('send-group-message')
  async sendGroupMessage(
    @Body() body: { clientId: string; to: string[]; message: string },
  ) {
    for (const num of body.to) {
      await this.whatsappService.sendMessage(
        '',
        body.clientId,
        num,
        body.message,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { message: 'Group message sent to all contacts.' };
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


