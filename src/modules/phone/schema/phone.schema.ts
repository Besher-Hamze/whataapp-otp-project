import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PhoneDocument = Phone & Document;

@Schema({ timestamps: true })
export class Phone {
  _id: Types.ObjectId;
  @Prop()
  name: string;
  @Prop({ required: true })
  number: string;
}

export const PhoneSchema = SchemaFactory.createForClass(Phone);
