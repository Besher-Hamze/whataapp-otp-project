import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';

// Global error handlers for WhatsApp protocol errors
process.on('unhandledRejection', (reason, promise) => {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as Error).message;
    if (message.includes('Protocol error') && 
        (message.includes('Session closed') || message.includes('Target closed'))) {
      console.debug(`[Global] Ignoring expected WhatsApp protocol error: ${message}`);
      return; // Don't crash on expected protocol errors
    }
  }
  
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // For other errors, log but don't crash the server
});

process.on('uncaughtException', (error) => {
  if (error.message.includes('Protocol error') && 
      (error.message.includes('Session closed') || error.message.includes('Target closed'))) {
    console.debug(`[Global] Ignoring expected WhatsApp protocol error: ${error.message}`);
    return; // Don't crash on expected protocol errors
  }
  
  console.error('Uncaught Exception:', error);
  // For critical errors, we might want to restart, but let's try to continue
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'], // Set logging levels
  });

  // Security middleware
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  // Enable CORS with secure configuration
  app.enableCors({
    origin: (origin, callback) => {
      // List of allowed origins
      const allowedOrigins = [
        'http://localhost:3000', // Common frontend dev URL
        'http://localhost:4200',
        'http://62.171.153.198:4082',
        "*", // Common for Angular
        process.env.FRONTEND_URL, // Production frontend URL
      ].filter(Boolean); // Remove null/undefined values

      // Allow requests with no origin (e.g., Postman, cURL) in development
      const isDevelopment = process.env.NODE_ENV !== 'production';

      if (!origin || allowedOrigins.includes(origin) || (isDevelopment && !origin)) {
        callback(null, true);
      } else {
        callback(null, true);
        console.log(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Requested-With',
    credentials: true, // Support cookies or auth headers
    maxAge: 86400, // Cache preflight requests for 1 day (in seconds)
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Remove unknown properties
    transform: true, // Transform payloads to DTO instances
  }));

  // Global filters
  app.useGlobalFilters(new GlobalExceptionFilter());

  // WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  const port = process.env.PORT || 3000;
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

  await app.listen(port, () => {
    console.log(`Server running on ${host}:${port} in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`API documentation available at http://${host}:${port}/api`);
  });
}

bootstrap().catch(err => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
