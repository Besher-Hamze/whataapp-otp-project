import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Subscription } from '../../subscriptions/schema/subscription.schema';
import { User } from '../../users/schema/users.schema';
import { SubscriptionStatus } from 'src/common/enum/subsription_status';

export type UserSubscriptionDocument = UserSubscription& Document;

@Schema({ timestamps: true })
export class UserSubscription {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  messageLimit: number;

  @Prop({ required: true })
  durationInDays: number;

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ default: false })
  isCustom: boolean;

  @Prop({ default: 0 })
  price: number;

  @Prop({ enum: SubscriptionStatus, default: SubscriptionStatus.PENDING })
  status: SubscriptionStatus;

  @Prop()
  approvedAt?: Date;

}

export const UserSubscriptionSchema = SchemaFactory.createForClass(UserSubscription);
