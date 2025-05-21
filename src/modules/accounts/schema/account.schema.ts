import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Define Account interface explicitly
export interface Account {
  _id: Types.ObjectId; // Add _id explicitly
  name: string;
  phone_number: string;
  user: Types.ObjectId;
}

export type AccountDocument = Account & Document;

@Schema({ timestamps: true })
export class Account {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone_number: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: false })
  clientId?: string;

  @Prop({ required: true, enum: ['active', 'disconnected'], default: 'active' })
  status: string;
}

export const AccountSchema = SchemaFactory.createForClass(Account);