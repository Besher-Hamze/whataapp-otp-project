import { Module } from '@nestjs/common';
import { AdminSubscriptionsController } from './subscriptions/admin-subscriptions.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UserSubscriptionsModule } from '../user-subscriptions/user-subscriptions.module'; // Adjust path if needed
import { UsersModule } from '../users/users.module'; // Adjust path if needed

@Module({
  imports: [SubscriptionsModule, UserSubscriptionsModule, UsersModule],
  controllers: [AdminSubscriptionsController],
})
export class AdminModule {}