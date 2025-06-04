import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Otp extends Document {
  @Prop({ required: true })
  phone_number: string;

  @Prop({ required: true })
  otp: string;

  @Prop({ required: true, expires: 300 }) // TTL index: 5 minutes (300 seconds)
  expires_at: Date;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);