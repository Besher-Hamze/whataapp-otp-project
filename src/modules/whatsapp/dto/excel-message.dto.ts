import { IsArray, IsString, ArrayNotEmpty, ValidateNested, IsOptional, IsNumber, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

class MessageItem {
  @IsString()
  @IsNotEmpty()
  number: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}

export class SendMessageExcelDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MessageItem)
  messages: MessageItem[];

  @IsNumber()
  @IsOptional()
  delayMs?: number;
}