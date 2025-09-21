import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSubscription, UserSubscriptionDocument } from './schema/user-subscription.schema';
import { User, UserDocument } from '../users/schema/users.schema';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../subscriptions/schema/subscription.schema';
import { SubscriptionStatus, UserSubscriptionStatus } from 'src/common/enum/subsription_status';

@Injectable()
export class UserSubscriptionsService {
  constructor(
    @InjectModel(UserSubscription.name)
    private readonly requestModel: Model<UserSubscriptionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // src/modules/user-subscriptions/user-subscriptions.service.ts
async create(subscriptionId: string, userId: string) {
  const subscriptionPlan = await this.subscriptionModel.findById(subscriptionId);
  
  if (!subscriptionPlan) {
    throw new BadRequestException('This subscription plan does not exist.');
  }

  const { _id, ...subscriptionData } = subscriptionPlan.toObject();

  // Find and update the user's subscription document.
  // If one does not exist, a new one will be created (upsert: true).
  return this.requestModel.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      status: SubscriptionStatus.PENDING,
      ...subscriptionData,
    },
    { new: true, upsert: true } // Return the new document, and create if it doesn't exist
  );
}

  // src/modules/user-subscriptions/user-subscriptions.service.ts
async findSubscriptionByUserId(userId: string) {
  // Find the single UserSubscription document for this user, regardless of its status
  return this.requestModel.findOne({ user: userId }).populate('user');
}

  async findAll() {
    return this.requestModel.find().populate('user');
  }

  async findPending() {
    return this.requestModel.find({ status: SubscriptionStatus.PENDING }).populate('user');
  }

  async approve(id: string): Promise<string> {
    const request = await this.requestModel.findById(id);
    if (!request) throw new NotFoundException('Subscription request not found');

    if (request.status === SubscriptionStatus.APPROVED) return 'Already approved';

    const now = new Date();
    const endDate = new Date(now.getTime() + request.durationInDays * 24 * 60 * 60 * 1000);

    // Update user's subscription
    await this.userModel.findByIdAndUpdate(request.user, {
      subscription: {
        name: request.name,
        messageLimit: request.messageLimit,
        durationInDays: request.durationInDays,
        features: request.features,
        isCustom: request.isCustom,
        startDate: now,
        endDate,
        messagesUsed: 0,
        status: UserSubscriptionStatus.ACTIVE,
      },
    });

    // Update the request itself
    request.status = SubscriptionStatus.APPROVED;
    request.approvedAt = now;
    await request.save();

    return 'Subscription approved and applied to user';
  }

  async disapprove(id: string): Promise<{ message: string }> {
    const request = await this.requestModel.findById(id);
    if (!request) {
      throw new NotFoundException('Subscription request not found.');
    }

    if (request.status === SubscriptionStatus.REJECTED) {
      return { message: 'Already disapproved' };
    }

    if (request.status === SubscriptionStatus.APPROVED) {
      return { message: 'Cannot disapprove an already approved subscription.' };
    }

    request.status = SubscriptionStatus.REJECTED;
    await request.save();

    return { message: 'Subscription request disapproved successfully. User\'s current plan remains unchanged.' };
  }

  async delete(id: string) {
    return this.requestModel.findByIdAndDelete(id);
  }
}
