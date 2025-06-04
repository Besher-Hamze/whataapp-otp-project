import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class GlobalErrorHandlerService implements OnModuleInit {
  private readonly logger = new Logger('GlobalErrorHandler');

  onModuleInit() {
    this.setupGlobalErrorHandlers();
  }

  private setupGlobalErrorHandlers() {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('🚨 Unhandled Promise Rejection:', reason);
      
      // Check if it's a WhatsApp Web.js related error
      if (this.isWhatsAppError(reason)) {
        this.logger.warn('🔧 WhatsApp-related error detected, continuing execution');
        // Don't crash the process for WhatsApp errors
        return;
      }
      
      // For other critical errors, log but don't crash immediately
      this.logger.error('💥 Critical unhandled rejection, but continuing execution');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('🚨 Uncaught Exception:', error);
      
      // Check if it's a WhatsApp Web.js related error
      if (this.isWhatsAppError(error)) {
        this.logger.warn('🔧 WhatsApp-related uncaught exception, continuing execution');
        return;
      }
      
      // For truly critical errors, log and potentially restart
      this.logger.error('💥 Critical uncaught exception');
      // Don't crash immediately, give time for cleanup
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    });

    // Handle SIGTERM gracefully
    process.on('SIGTERM', () => {
      this.logger.log('📡 SIGTERM received, starting graceful shutdown');
      // Application will handle this at the framework level
    });

    // Handle SIGINT gracefully
    process.on('SIGINT', () => {
      this.logger.log('📡 SIGINT received, starting graceful shutdown');
      // Application will handle this at the framework level
    });

    this.logger.log('🛡️ Global error handlers initialized');
  }

  private isWhatsAppError(error: any): boolean {
    if (!error) return false;
    
    const errorString = error.toString().toLowerCase();
    const whatsappKeywords = [
      'protocol error',
      'session closed',
      'target closed',
      'page has been closed',
      'execution context was destroyed',
      'runtime.callfunctionon',
      'puppeteer',
      'whatsapp-web.js',
      'widfactory',
      'browser has been closed',
      'connection closed',
      'cdpsession',
    ];

    return whatsappKeywords.some(keyword => errorString.includes(keyword));
  }

  // Method to manually log WhatsApp errors without crashing
  logWhatsAppError(error: any, context: string = 'WhatsApp') {
    this.logger.error(`🔧 ${context} Error (non-critical):`, error.message || error);
    
    // Could also send to monitoring service here
    if (process.env.NODE_ENV === 'production') {
      // Send to monitoring service like Sentry, DataDog, etc.
    }
  }

  // Method to check if an error should be ignored
  shouldIgnoreError(error: any): boolean {
    return this.isWhatsAppError(error);
  }
}