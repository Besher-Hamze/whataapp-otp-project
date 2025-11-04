import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../modules/users/schema/users.schema';
import { UserSubscriptionStatus } from '../enum/subsription_status';

@Injectable()
export class MessageLimitGuard implements CanActivate {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    // const userJwt = request.user; // from JWT (contains user.sub)

    // const user = await this.userModel.findById(userJwt.sub).lean();

    if (!user) {
      throw new ForbiddenException('User not found.');
    }

    const sub = user.subscription;

    const now = new Date();
    console.log(sub);

    // Check subscription is still active
    if (sub.endDate < now || sub.status !== UserSubscriptionStatus.ACTIVE) {
      throw new ForbiddenException('Your subscription is inactive or expired.');
    }

    // Check message limit
    if (sub.messagesUsed >= sub.messageLimit) {
      throw new ForbiddenException(
        'You have reached your message limit for this subscription.',
      );
    }

    // All checks passed
    return true;
  }
}
