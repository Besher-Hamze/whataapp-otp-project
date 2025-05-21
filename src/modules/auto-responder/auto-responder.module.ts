import { Module } from '@nestjs/common';
import { AutoResponderService } from './auto-responder.service';
import { RulesModule } from '../rules/rules.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AccountsModule } from '../accounts/accounts.module';
import { AutoResponderInitializer } from './auto-responder.initializer';

@Module({
  imports: [
    RulesModule,
    WhatsappModule,
    AccountsModule,
  ],
  providers: [AutoResponderService, AutoResponderInitializer],
  exports: [AutoResponderService],
})
export class AutoResponderModule {}
