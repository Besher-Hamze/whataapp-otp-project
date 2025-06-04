import { Injectable, NestInterceptor, ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

interface RateLimitConfig {
  points: number;        // Number of requests allowed
  duration: number;      // Time window in seconds
  blockDuration?: number; // Duration of block if limit exceeded (in seconds)
}

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly store = new Map<string, { count: number, resetTime: number, blockedUntil?: number }>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = {
      blockDuration: 300, // Default: 5 minutes block
      ...config, // This will override the defaults with passed config
    };
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Generate a key based on IP and optional user ID
    let key = request.ip || '127.0.0.1'; // Use a default if IP is undefined
    if (request.user && (request.user as any).sub) {
      key = `${key}:${(request.user as any).sub}`;
    }
    
    // Get current time
    const now = Date.now();
    
    // Initialize or get record
    let record = this.store.get(key) || {
      count: 0,
      resetTime: now + this.config.duration * 1000,
    };
    
    // Check if blocked
    if (record.blockedUntil && record.blockedUntil > now) {
      const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
      throw new HttpException(
        `Rate limit exceeded. Try again in ${retryAfter} seconds`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    
    // Reset if window expired
    if (record.resetTime <= now) {
      record.count = 0;
      record.resetTime = now + this.config.duration * 1000;
    }
    
    // Increment count
    record.count += 1;
    
    // Set the record in the store
    this.store.set(key, record);
    
    // Block if exceeded
    if (record.count > this.config.points) {
      const blockDuration = this.config.blockDuration || 300;
      record.blockedUntil = now + (blockDuration * 1000);
      throw new HttpException(
        `Rate limit exceeded. Try again in ${blockDuration} seconds`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    
    // Clean up old records every 10 minutes
    const cleanupKey = 'rateLimitCleanup';
    const lastCleanup = this.store.get(cleanupKey)?.resetTime || 0;
    if (now - lastCleanup > 10 * 60 * 1000) {
      this.cleanupStore(now);
      this.store.set(cleanupKey, { count: 0, resetTime: now });
    }
    
    return next.handle();
  }
  
  private cleanupStore(now: number) {
    for (const [key, record] of this.store.entries()) {
      if (record.resetTime < now && (!record.blockedUntil || record.blockedUntil < now)) {
        this.store.delete(key);
      }
    }
  }
}
