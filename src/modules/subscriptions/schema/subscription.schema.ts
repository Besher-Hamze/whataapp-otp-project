import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true })
  name: string; 

  @Prop({ required: true })
  messageLimit: number; 

  @Prop({ required: true })
  durationInDays: number;

  @Prop({ default: true })
  isActive: boolean; 

  @Prop({ default: false })
  isCustom: boolean; 

  @Prop({ type: [String], default: [] })
  features: string[]; 

  @Prop({ default: 0 })
  price: number; 

  @Prop()
  notes?: string; 
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
