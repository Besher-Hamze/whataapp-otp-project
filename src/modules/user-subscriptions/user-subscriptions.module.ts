import { Module } from '@nestjs/common';
import { UserSubscriptionsService } from './user-subscriptions.service';
import { UserSubscriptionsController } from './user-subscriptions.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schema/users.schema';
import { UserSubscription, UserSubscriptionSchema } from './schema/user-subscription.schema';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { Subscription, SubscriptionSchema } from '../subscriptions/schema/subscription.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserSubscription.name, schema: UserSubscriptionSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    SubscriptionsModule,
  ],
  controllers: [UserSubscriptionsController],
  providers: [UserSubscriptionsService],
  exports: [UserSubscriptionsService], // Add this line
})
export class UserSubscriptionsModule {}