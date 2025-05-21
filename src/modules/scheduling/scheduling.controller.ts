import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId } from 'src/common/decorators';

@UseGuards(JwtGuard)
@Controller('schedules')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post()
  create(
    @Body() createScheduleDto: CreateScheduleDto,
    @GetUserId() userId: string
  ) {
    return this.schedulingService.create(createScheduleDto, userId);
  }

  @Get()
  findAll(@GetUserId() userId: string) {
    return this.schedulingService.findAll(userId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.schedulingService.findOne(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
    @GetUserId() userId: string
  ) {
    return this.schedulingService.update(id, updateScheduleDto, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.schedulingService.remove(id, userId);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.schedulingService.cancelSchedule(id, userId);
  }
}