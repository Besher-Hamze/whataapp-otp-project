import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  Matches,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^\+\d+$/, {
    each: true,
    message: 'Each phone number must start with + and contain digits only.',
  })
  @Type(() => String)
  phone_numbers: string[];

  @IsMongoId()
  @IsNotEmpty()
  account: string;
}
