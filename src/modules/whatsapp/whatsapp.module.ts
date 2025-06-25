import { forwardRef, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from '../accounts/schema/account.schema';
import { User, UserSchema } from '../users/schema/users.schema';
import { AccountsModule } from '../accounts/accounts.module';
import { UsersModule } from '../users/users.module';
import { WhatsAppGateway } from './whatsapp.gateway';
import { GroupsModule } from '../groups/groups.module';
import { ContactsModule } from '../contacts/contacts.module';
import { TemplatesModule } from '../templates/templates.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { SessionManagerService } from './services/session-manager.service';
import { EventHandlerService } from './services/event-handler.service';
import { QRCodeService } from './services/qr-code.service';
import { MessageHandlerService } from './services/message-handler.service';
import { MessageSenderService } from './services/message-sender.service';
import { RecipientResolverService } from './services/recipient-resolver.service';
import { MessageContentResolverService } from './services/message-content-resolver.service';
import { FileManagerService } from './services/file-manager.service';
import { AccountService } from './services/account.service';
import { PuppeteerConfigService } from './services/puppeteer-config.service';
import { SessionRestorationService } from './services/session-restoration.service';
import { CleanupService } from './services/cleanup.service';
import { ReconnectionService } from './services/reconnection.service';
import { ProtocolErrorHandlerService } from './services/protocol-error-handler.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key', // Replace with your JWT secret
      signOptions: { expiresIn: '1h' }, // Adjust as needed
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
    UsersModule,
    AccountsModule,
    GroupsModule,
    ContactsModule,
    TemplatesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppGateway,
    WhatsAppService,
    SessionManagerService,
    EventHandlerService,
    QRCodeService,
    MessageHandlerService,
    MessageSenderService,
    RecipientResolverService,
    MessageContentResolverService,
    FileManagerService,
    AccountService,
    PuppeteerConfigService,
    SessionRestorationService,
    CleanupService,
    ReconnectionService,
    ProtocolErrorHandlerService,
  ],
  exports: [WhatsAppService]
})
export class WhatsappModule { }
