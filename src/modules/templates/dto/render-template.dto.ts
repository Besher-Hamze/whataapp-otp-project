import { IsObject, IsOptional, IsString } from 'class-validator';

export class RenderTemplateDto {
  @IsString()
  templateId: string;
  
  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;
}
