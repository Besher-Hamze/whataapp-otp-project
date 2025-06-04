import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || exception.message;
      } else {
        message = exception.message;
      }
    } else if (exception.name === 'ValidationError' || exception.name === 'CastError') {
      // Mongoose validation error
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
    } else if (exception.name === 'MongoError' || exception.name === 'MongoServerError') {
      if (exception.code === 11000) {
        // Duplicate key error
        status = HttpStatus.CONFLICT;
        message = 'Duplicate entry';
      }
    }
    
    // Log the error with appropriate level
    const errorLog = {
      path: request.url,
      method: request.method,
      ip: request.ip,
      user: (request as any).user?.sub,
      body: request.body,
      timestamp: new Date().toISOString(),
      error: exception.message,
      stack: exception.stack,
    };
    
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} ${status}`, errorLog);
    } else {
      this.logger.warn(`${request.method} ${request.url} ${status}`, errorLog);
    }
    
    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
