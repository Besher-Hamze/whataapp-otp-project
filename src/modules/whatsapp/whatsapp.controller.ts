import { Controller, Post, Body, Get } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('start')
  startSession(@Body('clientId') clientId: string) {
    console.log("TTTTTTTTTTTTTTTTTTTT");
    
    return this.whatsappService.startSession(clientId);
  }

  @Post('send-message')
  sendMessage(@Body() body: { clientId: string; to: string; message: string }) {
    return this.whatsappService.sendMessage(
      body.clientId,
      body.to,
      body.message,
    );
  }

  @Post('send-group-message')
  async sendGroupMessage(
    @Body()
    body: {
      clientId: string;
      to: string[];
      message: string;
    },
  ) {
    for (const num of body.to) {
      await this.whatsappService.sendMessage(body.clientId, num, body.message);
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
}
