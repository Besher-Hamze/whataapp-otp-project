import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetUserId = createParamDecorator(
  (data: keyof Express.User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return user.userId;
  },
);

export const GetWhatsappAccountId = createParamDecorator(
  (data: keyof Express.User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if(!user.account_id){
      throw new BadRequestException("You Should select an account ");
    }
    return user.account_id;
  },
);
