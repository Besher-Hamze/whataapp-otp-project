import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { MessagesModule } from './modules/messages/messages.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SavedMessagesModule } from './modules/saved-masseges/saved-messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    ScheduleModule.forRoot(),
    UsersModule,
    AccountsModule,
    AuthModule,
    WhatsappModule,
    ContactsModule,
    MessagesModule,
    GroupsModule,
    SavedMessagesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
