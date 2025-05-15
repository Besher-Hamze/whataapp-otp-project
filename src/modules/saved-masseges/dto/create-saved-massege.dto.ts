import { Prop } from '@nestjs/mongoose';
import {} from 'class-validator'

export class CreateSavedMessageDto {
    
    @Prop({ required: true })
      content: string;
    
}
