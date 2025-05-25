import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {

  _id: Types.ObjectId;
  @Prop({ required: true })
  name: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Contact' }] })
  contacts: Types.ObjectId[];

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' }) // or Account
  account: Types.ObjectId;


}

export const GroupSchema = SchemaFactory.createForClass(Group);
