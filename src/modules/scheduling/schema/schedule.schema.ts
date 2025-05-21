import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Account } from '../../accounts/schema/account.schema';
import { User } from '../../users/schema/users.schema';

export enum ScheduleStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Schedule extends Document {
  @Prop({ required: true })
  message: string;

  @Prop({ required: true, type: [String] })
  recipients: string[];

  @Prop({ required: true, type: Date })
  scheduledTime: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account', required: true })
  whatsappAccount: Account;
  
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ 
    type: String, 
    enum: Object.values(ScheduleStatus), 
    default: ScheduleStatus.PENDING 
  })
  status: ScheduleStatus;

  @Prop({ type: Date, default: null })
  completedAt: Date;

  @Prop({ default: null })
  error: string;

  @Prop({ default: 5000 }) // Default delay of 5 seconds between messages
  messageDelayMs: number;
}

export type ScheduleDocument = Schedule & Document;
export const ScheduleSchema = SchemaFactory.createForClass(Schedule);