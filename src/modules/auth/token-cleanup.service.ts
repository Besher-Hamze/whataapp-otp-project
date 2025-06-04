import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Token } from './schema/refresh-token.schema';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(@InjectModel(Token.name) private tokenModel: Model<Token>) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiredTokens() {
    try {
      const now = new Date();
      const result = await this.tokenModel.deleteMany({ expiresAt: { $lt: now } });
      // No logging as per your preference
    } catch (error) {
      this.logger.error(`Failed to delete expired tokens: ${error.message}`);
    }
  }
}