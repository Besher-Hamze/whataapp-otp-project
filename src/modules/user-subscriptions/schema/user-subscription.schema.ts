import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Document } from 'mongoose';

export type UserSubscriptionDocument = UserSubscription & Document;

@Schema({ timestamps: true })
export class UserSubscription {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  name: string; // Plan name

  @Prop({ required: true })
  messageLimit: number;

  @Prop({ required: true })
  durationInDays: number;

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ default: false })
  isCustom: boolean;

  @Prop({ enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status: 'pending' | 'approved' | 'rejected';


}

export const UserSubscriptionSchema = SchemaFactory.createForClass(UserSubscription);
