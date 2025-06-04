import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiKey } from '../../modules/OTP/schema/api-key.schema';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKey>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    const apiKeyRecord = await this.apiKeyModel.findOne({ key: apiKey, isActive: true });
    if (!apiKeyRecord) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach accountId and userId to request for downstream use
    request.user = { 
      userId: apiKeyRecord.userId,
      accountId: apiKeyRecord.accountId 
    };

    return true;
  }
}