import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, SubscriptionDocument } from './schema/subscription.schema';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  async create(createDto: CreateSubscriptionDto): Promise<Subscription> {
    const newSub = new this.subscriptionModel(createDto);
    return newSub.save();
  }

  async findAll(): Promise<Subscription[]> {
    return this.subscriptionModel.find().exec();
  }

  async findOne(id: string): Promise<Subscription> {
    const sub = await this.subscriptionModel.findById(id);
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async update(id: string, updateDto: UpdateSubscriptionDto): Promise<Subscription> {
    const updated = await this.subscriptionModel.findByIdAndUpdate(id, updateDto, { new: true });
    if (!updated) throw new NotFoundException('Subscription not found');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const result = await this.subscriptionModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Subscription not found');
  }

  async deactivate(id: string): Promise<Subscription> {
    const updated = await this.subscriptionModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Subscription not found');
    return updated;
  }
}
