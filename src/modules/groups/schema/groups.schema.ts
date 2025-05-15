import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Group extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], required: true, default: [] })
  phone_numbers: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Account' })
  account: string;
}

export const GroupSchema = SchemaFactory.createForClass(Group);