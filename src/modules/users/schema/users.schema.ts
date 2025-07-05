import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Define User interface explicitly
export interface User {
  _id: Types.ObjectId; // Add _id explicitly
  email: string;
  password: string;
  username: string;
  phone_number: string;
}

@Schema({ _id: false })
class EmbeddedSubscription {
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

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ default: 0 })
  messagesUsed: number;

  @Prop({ enum: ['active', 'warning', 'expired'], default: 'active' })
  status: 'active' | 'warning' | 'expired';
}


function getFreePlan(): Partial<EmbeddedSubscription> {
  const now = new Date();
  return {
    name: 'Free',
    messageLimit: 1000,
    durationInDays: 30,
    features: ['Basic messaging'],
    isCustom: false,
    startDate: now,
    endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    messagesUsed: 0,
    status: 'active',
  };
}


const EmbeddedSubscriptionSchema = SchemaFactory.createForClass(EmbeddedSubscription);

export type UserDocument = User & Document;

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class User extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true , unique: true })
  username: string;

  @Prop({ type: EmbeddedSubscriptionSchema, default: getFreePlan })
  subscription: EmbeddedSubscription;

}

export const UserSchema = SchemaFactory.createForClass(User);