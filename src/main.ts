import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { getCorsOptions } from './config/cors.config';

async function bootstrap() {
  // bufferLogs holds any log lines emitted during module initialization
  // until the real (pino) logger is attached below, instead of losing them
  // to Nest's default console logger.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  
  // Security middleware - helmet with CSP and HSTS
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  }));
  
  // Payload size limits (1MB)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  
  // CORS configuration
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  app.enableCors(getCorsOptions(nodeEnv));
  
  app.enableShutdownHooks();

  // Swagger/OpenAPI setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Splitcore API')
    .setDescription('Splitcore backend API - Expense splitting and payment management')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token',
      },
      'JWT',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Splitcore API Docs',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = config.get<number>('port') ?? 3000;

  await app.listen(port);
  app.get(Logger).log(`Splitcore backend listening on port ${port}`);
  app.get(Logger).log(`API documentation available at /api/docs`);
}

bootstrap();
