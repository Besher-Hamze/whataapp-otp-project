// src/modules/seed/seed.module.ts
import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { UsersModule } from '../users/users.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [UsersModule, SubscriptionsModule], // All necessary modules for seeding
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}