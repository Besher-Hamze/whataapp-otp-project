import { PartialType } from '@nestjs/mapped-types';
import { CreateSavedMessageDto } from './create-saved-massege.dto';

export class UpdateSavedMessageDto extends PartialType(CreateSavedMessageDto) {}
