// src/common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/index';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true; // No roles required — allow access

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.userRole) {
      throw new ForbiddenException('User role not found.');
    }

    if (!requiredRoles.includes(user.userRole)) {
      throw new ForbiddenException('Access denied: insufficient role.');
    }

    return true;
  }
}
