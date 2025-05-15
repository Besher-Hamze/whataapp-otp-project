import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema()
export class Message {
  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], required: true })
  number_list: string[];

  @Prop({ required: true })
  schedule_time: Date;

  @Prop({ type: 'ObjectId', ref: 'Account', required: true })
  account?: string;

  @Prop({ type: 'ObjectId', ref: 'Contact', required: true })
  contact?: string;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  group?: string;

}

export const MessageSchema = SchemaFactory.createForClass(Message);