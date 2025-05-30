import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema()
export class Group extends Document {

  _id: Types.ObjectId;
  @Prop({ required: true })
  name: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Contact' }] })
  contacts: Types.ObjectId[];

  @Prop({ required: true, type: Types.ObjectId, ref: 'Account' }) // or Account
  account: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}
export type GroupDocument = Group & Document;
export const GroupSchema = SchemaFactory.createForClass(Group);
