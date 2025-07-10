import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSubscription, UserSubscriptionDocument } from './schema/user-subscription.schema';
import { CreateUserSubscriptionDto } from './dto/create-user-subscription.dto';
import { User, UserDocument } from '../users/schema/users.schema';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class UserSubscriptionsService {
  constructor(
    @InjectModel(UserSubscription.name)
    private readonly requestModel: Model<UserSubscriptionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(dto: CreateUserSubscriptionDto) {
    return this.requestModel.create({ ...dto, status: 'pending' });
  }

  async findAll() {
    return this.requestModel.find().populate('user');
  }

  async findPending() {
    return this.requestModel.find({ status: 'pending' }).populate('user');
  }

  async approve(id: string): Promise<string> {
    const request = await this.requestModel.findById(id);
    if (!request) throw new NotFoundException('Subscription request not found');

    if (request.status === 'approved') return 'Already approved';

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
        status: 'active',
      },
    });

    // Update the request itself
    request.status = 'approved';
    request.approvedAt = now;
    await request.save();

    return 'Subscription approved and applied to user';
  }

  async delete(id: string) {
    return this.requestModel.findByIdAndDelete(id);
  }
}
