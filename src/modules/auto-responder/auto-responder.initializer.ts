import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AutoResponderService } from './auto-responder.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class AutoResponderInitializer implements OnModuleInit {
  private readonly logger = new Logger(AutoResponderInitializer.name);
  
  constructor(
    private readonly autoResponderService: AutoResponderService,
    private readonly whatsAppService: WhatsAppService,
  ) {}
  
  async onModuleInit() {
  this.logger.log('Initializing auto-responder...');
  
  this.whatsAppService.registerMessageHandler(async (message, accountId) => {
    try {
      const sender = message.from.split('@')[0]; // Safe access
      // Defer body access to autoresponder
      const responded = await this.autoResponderService.handleIncomingMessage('', sender, accountId);
      
      if (responded) {
        this.logger.log(`Auto-responded to message from ${sender}`);
      } else {
        this.logger.debug(`No auto-response for message from ${sender}`);
      }
    } catch (error) {
      this.logger.error(`Error processing message for auto-response: ${error.message}`);
    }
  });
  
  this.logger.log('Auto-responder initialized successfully');
}
}
