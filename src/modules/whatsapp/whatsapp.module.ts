import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from '../accounts/schema/account.schema';
import { User, UserSchema } from '../users/schema/users.schema';
import { AccountsModule } from '../accounts/accounts.module';
import { UsersModule } from '../users/users.module';
import { WhatsAppGateway } from './whatsapp.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
    UsersModule,
    AccountsModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppGateway, WhatsAppService],
  exports: [WhatsAppService]
})
export class WhatsappModule {}
