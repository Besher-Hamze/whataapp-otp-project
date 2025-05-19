import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  IsMongoId,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContactInGroupDto } from './contact-in-group.dto'; // ✅ use new DTO

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContactInGroupDto) // ✅ replace CreateContactDto
  phone_numbers: ContactInGroupDto[];

  @IsMongoId()
  @IsNotEmpty()
  account: string;
}
