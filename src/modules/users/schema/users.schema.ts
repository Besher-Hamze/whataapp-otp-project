import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserRole } from 'src/common/enum/user_role';
import { UserSubscriptionStatus } from 'src/common/enum/subsription_status';

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

  @Prop({ enum: UserSubscriptionStatus, default: UserSubscriptionStatus.ACTIVE })
  status: UserSubscriptionStatus;
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
    status: UserSubscriptionStatus.ACTIVE,
  };
}


const EmbeddedSubscriptionSchema = SchemaFactory.createForClass(EmbeddedSubscription);

export type UserDocument = User & Document;

@Schema()
export class User extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true , unique: true })
  username: string;

  @Prop({ type: EmbeddedSubscriptionSchema, default: getFreePlan })
  subscription: EmbeddedSubscription;

  @Prop({ 
    required: true, 
    enum: UserRole, 
    default: UserRole.USER 
  })
  userRole: UserRole;
}


export const UserSchema = SchemaFactory.createForClass(User);