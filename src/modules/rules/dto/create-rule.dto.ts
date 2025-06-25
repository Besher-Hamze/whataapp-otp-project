import { IsArray, IsString, ArrayNotEmpty, IsNotEmpty } from 'class-validator';

export class CreateRuleDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  keywords: string[]; // Changed from [string] to string[] for proper TypeScript array

  @IsString()
  @IsNotEmpty()
  response: string;
}