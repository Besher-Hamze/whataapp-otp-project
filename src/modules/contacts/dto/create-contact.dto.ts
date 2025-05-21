import { IsString, IsNotEmpty, Matches, IsMongoId, IsOptional, IsArray, IsBoolean, IsObject } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @Matches(/^\+?[\d\s-]+$/, {
    message: 'Phone number must contain digits and optional +, spaces, or hyphens.',
  })
  phone_number: string;

  @IsMongoId()
  @IsOptional()
  account?: string;
  
  @IsArray()
  @IsOptional()
  @Type(() => String)
  groups?: string[];
  
  @IsArray()
  @IsOptional()
  @Type(() => String)
  tags?: string[];
  
  @IsString()
  @IsOptional()
  notes?: string;
  
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  starred?: boolean;
  
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
