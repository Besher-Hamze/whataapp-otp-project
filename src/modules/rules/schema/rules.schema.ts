import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from 'src/modules/users/schema/users.schema';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Rule extends Document {
  @Prop({ required: true })
  keyword: string;

  @Prop({ required: true })
  response: string;
  
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User | string;
}

export type RuleDocument = Rule & Document;
export const RuleSchema = SchemaFactory.createForClass(Rule);