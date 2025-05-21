import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Schedule, ScheduleDocument, ScheduleStatus } from './schema/schedule.schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AccountsService } from '../accounts/accounts.service';
import { CronJob } from 'cron';

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);
  private processingSchedules = new Set<string>();

  constructor(
    @InjectModel(Schedule.name) private scheduleModel: Model<ScheduleDocument>,
    private readonly whatsAppService: WhatsAppService,
    private readonly accountsService: AccountsService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async create(createScheduleDto: CreateScheduleDto, userId: string) {
    try {
      // Verify the whatsapp account exists and belongs to this user
      const account = await this.accountsService.findOne(createScheduleDto.whatsappAccountId, userId);
      if (!account) {
        throw new NotFoundException('WhatsApp account not found or does not belong to this user');
      }

      // Make sure scheduled time is in the future
      const scheduledTime = new Date(createScheduleDto.scheduledTime);
      if (scheduledTime <= new Date()) {
        throw new BadRequestException('Scheduled time must be in the future');
      }

      // Create the schedule
      const newSchedule = await this.scheduleModel.create({
        message: createScheduleDto.message,
        recipients: createScheduleDto.recipients,
        scheduledTime: scheduledTime,
        whatsappAccount: createScheduleDto.whatsappAccountId,
        user: userId,
        status: ScheduleStatus.PENDING,
        messageDelayMs: createScheduleDto.messageDelayMs || 5000, // Default to 5 seconds if not provided
      });

      // Create a one-time cron job for this specific schedule
      this.createScheduleJob(newSchedule);

      return newSchedule;
    } catch (error) {
      this.logger.error(`Failed to create schedule: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createScheduleJob(schedule: ScheduleDocument) {
    try {
      const scheduleId = schedule._id?.toString();
      if (!scheduleId) {
        this.logger.warn('Schedule ID is missing or invalid');
        return;
      }
      
      const scheduledTime = new Date(schedule.scheduledTime);
      const now = new Date();
      
      if (scheduledTime <= now) {
        // If schedule time is in the past or now, process immediately
        this.processSchedule(scheduleId).catch(err => {
          this.logger.error(`Failed to process immediate schedule ${scheduleId}: ${err.message}`);
        });
        return;
      }
      
      const jobName = `schedule_${scheduleId}`;
      
      // Calculate time difference in milliseconds
      const timeUntilExecution = scheduledTime.getTime() - now.getTime();
      
      // Create a timeout based job
      const job = setTimeout(async () => {
        try {
          await this.processSchedule(scheduleId);
        } catch (error) {
          this.logger.error(`Error processing scheduled job ${jobName}: ${error.message}`);
        }
      }, timeUntilExecution);
      
      // Register the job so it can be cancelled if needed
      this.schedulerRegistry.addTimeout(jobName, job);
      
      this.logger.log(`Scheduled job ${jobName} created for ${scheduledTime.toISOString()}`);
    } catch (error) {
      this.logger.error(`Failed to create schedule job: ${error.message}`, error.stack);
    }
  }

  async findAll(userId: string) {
    return this.scheduleModel.find({ user: userId })
      .sort({ scheduledTime: -1 })
      .populate('whatsappAccount', 'name phone_number')
      .exec();
  }

  async findOne(id: string, userId: string) {
    const schedule = await this.scheduleModel.findOne({ _id: id, user: userId })
      .populate('whatsappAccount', 'name phone_number')
      .exec();
    
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID "${id}" not found`);
    }
    
    return schedule;
  }

  async update(id: string, updateScheduleDto: UpdateScheduleDto, userId: string) {
    const schedule = await this.findOne(id, userId);
    
    // Don't allow updating completed or processing schedules
    if ([ScheduleStatus.COMPLETED, ScheduleStatus.PROCESSING].includes(schedule.status as ScheduleStatus)) {
      throw new BadRequestException(`Cannot update a schedule that is ${schedule.status}`);
    }
    
    // If updating scheduled time, make sure it's in the future
    if (updateScheduleDto.scheduledTime) {
      const newScheduledTime = new Date(updateScheduleDto.scheduledTime);
      if (newScheduledTime <= new Date()) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
      
      // If there's an existing job for this schedule, delete it
      try {
        const jobName = `schedule_${id}`;
        this.schedulerRegistry.deleteTimeout(jobName);
        this.logger.log(`Deleted existing job ${jobName}`);
      } catch (error) {
        // Job might not exist, which is fine
      }
    }
    
    // Update the schedule
    const updatedSchedule = await this.scheduleModel.findByIdAndUpdate(
      id,
      { 
        ...updateScheduleDto,
        ...(updateScheduleDto.whatsappAccountId && { whatsappAccount: updateScheduleDto.whatsappAccountId })
      },
      { new: true }
    ).exec();
    
    // If we're updating the scheduled time, create a new job
    if (updateScheduleDto.scheduledTime && updatedSchedule) {
      this.createScheduleJob(updatedSchedule);
    }
    
    return updatedSchedule;
  }

  async remove(id: string, userId: string) {
    const schedule = await this.findOne(id, userId);
    
    // Don't allow deleting processing schedules
    if (schedule.status === ScheduleStatus.PROCESSING) {
      throw new BadRequestException('Cannot delete a schedule that is currently processing');
    }
    
    // If there's a job for this schedule, delete it
    try {
      const jobName = `schedule_${id}`;
      this.schedulerRegistry.deleteTimeout(jobName);
    } catch (error) {
      // Job might not exist, which is fine
    }
    
    await this.scheduleModel.findByIdAndDelete(id).exec();
    return { id, message: 'Schedule deleted successfully' };
  }

  async cancelSchedule(id: string, userId: string) {
    const schedule = await this.findOne(id, userId);
    
    // Only pending schedules can be cancelled
    if (schedule.status !== ScheduleStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel a schedule that is ${schedule.status}`);
    }
    
    // If there's a job for this schedule, delete it
    try {
      const jobName = `schedule_${id}`;
      this.schedulerRegistry.deleteTimeout(jobName);
    } catch (error) {
      // Job might not exist, which is fine
    }
    
    // Update status to cancelled
    await this.scheduleModel.findByIdAndUpdate(id, { 
      status: ScheduleStatus.CANCELLED 
    }).exec();
    
    return { id, message: 'Schedule cancelled successfully' };
  }

  // Process pending schedules every minute
  @Cron('0 * * * * *')
  async handleCron() {
    const now = new Date();
    const pendingSchedules = await this.scheduleModel.find({
      status: ScheduleStatus.PENDING,
      scheduledTime: { $lte: now }
    }).exec();
    
    this.logger.log(`Found ${pendingSchedules.length} pending schedules to process`);
    
    for (const schedule of pendingSchedules) {
      const scheduleId = schedule._id?.toString();
      if (scheduleId) {
        // Process each pending schedule if it's not already being processed
        if (!this.processingSchedules.has(scheduleId)) {
          this.processSchedule(scheduleId).catch(err => {
            this.logger.error(`Failed to process schedule ${scheduleId}: ${err.message}`);
          });
        }
      }
    }
  }

  async processSchedule(scheduleId: string) {
    if (this.processingSchedules.has(scheduleId)) {
      this.logger.log(`Schedule ${scheduleId} is already being processed`);
      return;
    }
    
    this.processingSchedules.add(scheduleId);
    
    try {
      const schedule = await this.scheduleModel.findById(scheduleId).exec();
      
      if (!schedule || schedule.status !== ScheduleStatus.PENDING) {
        this.processingSchedules.delete(scheduleId);
        return;
      }
      
      // Update status to processing
      await this.scheduleModel.findByIdAndUpdate(scheduleId, { 
        status: ScheduleStatus.PROCESSING 
      }).exec();
      
      // Get the whatsapp account and client
      const account = await this.accountsService.findById(schedule.whatsappAccount?.toString());
      
      if (!account || !account.clientId) {
        throw new Error('WhatsApp account not found or not connected');
      }
      
      // Send the messages with delay between each recipient
      let hasError = false;
      let errorMessage = '';
      
      // Send to each recipient with a delay
      for (let i = 0; i < schedule.recipients.length; i++) {
        try {
          const recipient = schedule.recipients[i];
          await this.whatsAppService.sendMessage(account.clientId, [recipient], schedule.message);
          
          // Log progress
          this.logger.log(`Sent message to ${recipient} (${i+1}/${schedule.recipients.length})`);
          
          // If there are more recipients, delay before the next one
          if (i < schedule.recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, schedule.messageDelayMs));
          }
        } catch (error) {
          hasError = true;
          errorMessage = `Error sending to recipient ${schedule.recipients[i]}: ${error.message}`;
          this.logger.error(errorMessage);
          break;
        }
      }
      
      // Update the schedule status based on results
      await this.scheduleModel.findByIdAndUpdate(scheduleId, { 
        status: hasError ? ScheduleStatus.FAILED : ScheduleStatus.COMPLETED,
        completedAt: hasError ? null : new Date(),
        error: hasError ? errorMessage : null
      }).exec();
      
    } catch (error) {
      // Update the schedule with error information
      await this.scheduleModel.findByIdAndUpdate(scheduleId, { 
        status: ScheduleStatus.FAILED,
        error: error.message
      }).exec();
      
      this.logger.error(`Error processing schedule ${scheduleId}: ${error.message}`);
    } finally {
      this.processingSchedules.delete(scheduleId);
    }
  }

  // Initialize all pending schedules on application startup
  async initSchedules() {
    try {
      // Find all pending schedules
      const pendingSchedules = await this.scheduleModel.find({
        status: ScheduleStatus.PENDING
      }).exec();
      
      this.logger.log(`Initializing ${pendingSchedules.length} pending schedules`);
      
      // Create jobs for each pending schedule
      for (const schedule of pendingSchedules) {
        this.createScheduleJob(schedule);
      }
      
      // Reset any "processing" schedules back to pending (in case of server crash)
      await this.scheduleModel.updateMany(
        { status: ScheduleStatus.PROCESSING },
        { status: ScheduleStatus.PENDING }
      ).exec();
      
    } catch (error) {
      this.logger.error(`Failed to initialize schedules: ${error.message}`, error.stack);
    }
  }
}