import { Prop } from '@nestjs/mongoose';
import { IsArray, IsString } from 'class-validator'

export class CreateRuleDto {

  @IsArray()
  keywords: [string];
  @IsString()
  response: string;
}
