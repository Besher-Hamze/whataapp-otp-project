import { Module, OnModuleInit } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Schedule, ScheduleSchema } from './schema/schedule.schema';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Schedule.name, schema: ScheduleSchema }]),
    WhatsappModule,
    AccountsModule
  ],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService]
})
export class SchedulingModule implements OnModuleInit {
  constructor(private readonly schedulingService: SchedulingService) {}

  async onModuleInit() {
    // Initialize all pending schedules when app starts
    await this.schedulingService.initSchedules();
  }
}