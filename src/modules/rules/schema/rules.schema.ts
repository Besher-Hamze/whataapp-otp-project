import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Rule extends Document {
  @Prop({ required: true , unique: true })
    keyword: string;

  @Prop({required: true})
    response :string;
}

export const RuleSchema = SchemaFactory.createForClass(Rule);