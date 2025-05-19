import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema()
export class Group extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Contact' }] })
  contacts: Types.ObjectId[];

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' }) // or Account
  account: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
