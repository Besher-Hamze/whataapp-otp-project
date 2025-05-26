import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({timestamps : true})
export class Message {
  @Prop({ required: true })
  chatId: string;
  
  @Prop({ required: true })
  message: string;

  @Prop({ required: true })
  send_date?: Date;

  @Prop({ type: 'ObjectId', ref: 'Account', required: true })
  client: string;

  @Prop({ required: true, enum: ['pending', 'sent', 'failed'], default: 'pending' })
  status: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);