import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, user } = request;
    const userId = user?.sub || 'anonymous';
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    const startTime = Date.now();
    
    return next.handle().pipe(
      tap({
        next: (data) => {
          const responseTime = Date.now() - startTime;
          
          this.logger.log(
            `${method} ${url} ${ip} ${userId} ${responseTime}ms`,
            {
              method,
              url,
              ip,
              userId,
              userAgent,
              responseTime,
              timestamp: new Date().toISOString(),
            }
          );
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;
          
          this.logger.error(
            `${method} ${url} ${ip} ${userId} ${error.status || 500} ${responseTime}ms`,
            {
              method,
              url,
              ip,
              userId,
              userAgent,
              error: error.message,
              stack: error.stack,
              responseTime,
              timestamp: new Date().toISOString(),
            }
          );
        }
      })
    );
  }
}
