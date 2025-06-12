import { Prop } from '@nestjs/mongoose';
import { IsString } from 'class-validator'

export class CreateRuleDto {

  @IsString()
  keywords: [string];
  @IsString()
  response: string;
}
