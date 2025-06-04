import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Otp } from './schema/otp.schema';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class OtpService {
    private readonly logger = new Logger(WhatsAppService.name);
  constructor(
    @InjectModel(Otp.name) private otpModel: Model<Otp>,
    private whatsappService: WhatsAppService,
  ) {}

  async storeOtp(phone_number: string, otp: string): Promise<void> {
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);

    await this.otpModel.deleteMany({ phone_number });
    await this.otpModel.create({ phone_number, otp, expires_at });

    this.logger.log(`OTP stored for ${phone_number}`);
  }

  async verifyOtp(phone_number: string, otp: string): Promise<boolean> {
    const record = await this.otpModel.findOne({ phone_number, otp });
    if (!record) {
      throw new BadRequestException('Invalid OTP');
    }
    if (record.expires_at < new Date()) {
      throw new BadRequestException('OTP has expired');
    }
    await this.otpModel.deleteOne({ _id: record._id });
    return true;
  }
}