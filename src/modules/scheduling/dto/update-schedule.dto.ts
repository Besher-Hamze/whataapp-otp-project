import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ScheduleStatus } from '../schema/schedule.schema';
import { PartialType } from '@nestjs/mapped-types';
import { CreateScheduleDto } from './create-schedule.dto';

export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;
}