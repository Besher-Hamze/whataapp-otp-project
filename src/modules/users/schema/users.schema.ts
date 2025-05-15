import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Define User interface explicitly
export interface User {
  _id: Types.ObjectId; // Add _id explicitly
  email: string;
  password: string;
  username: string;
  phone_number: string;
}

export type UserDocument = User & Document;

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class User extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  phone_number: string;
}

export const UserSchema = SchemaFactory.createForClass(User);