import { Prop } from '@nestjs/mongoose';
import { IsString } from 'class-validator'

export class CreateRuleDto {

  @IsString()
  keyword: string;
  @IsString()
  response: string;
}
