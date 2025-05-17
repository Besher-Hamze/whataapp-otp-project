import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

@Schema({
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Group extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], required: true, default: [] })
  phone_numbers: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account', required: true })
  account: Types.ObjectId;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
