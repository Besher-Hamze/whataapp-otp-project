import { IsString, IsNotEmpty, IsEnum, IsOptional, IsBoolean, IsArray, IsObject } from 'class-validator';
import { TemplateType } from '../schema/template.schema';
import { Type } from 'class-transformer';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;
  
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
  
  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;
}
