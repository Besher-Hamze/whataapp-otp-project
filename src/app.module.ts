import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { MessagesModule } from './modules/messages/messages.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SavedMessagesModule } from './modules/saved-masseges/saved-messages.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { RulesModule } from './modules/rules/rules.module';
import { AutoResponderModule } from './modules/auto-responder/auto-responder.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitInterceptor } from './common/interceptors/rate-limit.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        connectionFactory: (connection) => {
          connection.on('connected', () => {
            console.log('MongoDB connected successfully');
          });
          connection.on('error', (error) => {
            console.error('MongoDB connection error:', error);
          });
          connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
          });
          return connection;
        }
      }),
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Feature modules
    UsersModule,
    AccountsModule,
    AuthModule,
    WhatsappModule,
    ContactsModule,
    MessagesModule,
    GroupsModule,
    SavedMessagesModule,
    SchedulingModule,
    RulesModule,
    AutoResponderModule,
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global rate limiting interceptor
    {
      provide: APP_INTERCEPTOR,
      useFactory: (configService: ConfigService) => {
        return new RateLimitInterceptor({
          points: configService.get<number>('THROTTLE_LIMIT', 100),
          duration: configService.get<number>('THROTTLE_TTL', 60),
        });
      },
      inject: [ConfigService],
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule { }
