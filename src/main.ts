import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (origin, callback) => {
      // List of allowed origins
      const allowedOrigins = [
        'http://localhost:3000', // Common frontend dev URL
        'http://localhost:4200', // Common for Angular
        'https://your-frontend-app.com', // Replace with production frontend URL when known
        '*'
      ];

      // Allow requests with no origin (e.g., Postman, cURL) or if origin is in allowed list
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS blocked request from origin: ${origin}`);
                callback(null, true);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true, // Support cookies or auth headers (e.g., JWT)
  });
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.useWebSocketAdapter(new IoAdapter(app)); 
  await app.listen(3000, '0.0.0.0' , ()=> {
        console.log("App Started on : http://localhost:3000");
  }); 
}

bootstrap();
