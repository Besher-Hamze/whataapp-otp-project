import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Define Account interface explicitly
export interface Account {
  _id: Types.ObjectId; // Add _id explicitly
  name: string;
  phone_number: string;
  user: Types.ObjectId;
  clientId?: string;
  status: string;
  sessionData?: {
    isAuthenticated: boolean;
    lastConnected: Date;
    authState: string;
    sessionValid: boolean;
  };
}

export type AccountDocument = Account & Document;

@Schema({ timestamps: true })
export class Account {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone_number: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: false })
  clientId?: string;

  @Prop({ required: true, enum: ['active', 'disconnected', 'authenticating', 'ready'], default: 'active' })
  status: string;

  @Prop({ 
    type: {
      isAuthenticated: { type: Boolean, default: false },
      lastConnected: { type: Date, default: Date.now },
      authState: { type: String, default: 'pending' },
      sessionValid: { type: Boolean, default: false }
    },
    default: () => ({
      isAuthenticated: false,
      lastConnected: new Date(),
      authState: 'pending',
      sessionValid: false
    })
  })
  sessionData?: {
    isAuthenticated: boolean;
    lastConnected: Date;
    authState: string;
    sessionValid: boolean;
  };
}

export const AccountSchema = SchemaFactory.createForClass(Account);