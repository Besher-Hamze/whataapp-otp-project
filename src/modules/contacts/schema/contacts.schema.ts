import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema()
export class Contact extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  phone_number: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Group' }] })
  groups: Types.ObjectId[];

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' }) // or Account
  account: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
