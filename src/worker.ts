// Import instrument.ts first for Sentry initialization
import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { WorkerModule } from './worker/worker.module';

/**
 * Queue worker entry point.
 * 
 * This process runs independently from the API server (src/main.ts).
 * It connects to Redis and processes background jobs from BullMQ queues.
 * 
 * The worker does NOT start an HTTP server - it only processes jobs.
 * 
 * Deployment:
 * - On Render: Deployed as a separate "Worker" service
 * - Locally: Run with `npm run start:worker:dev`
 */
async function bootstrap() {
  // Create application context (no HTTP server)
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  // Attach pino logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Get configuration
  const config = app.get(ConfigService);
  
  const redisHost = config.get<string>('redis.host');
  const redisPort = config.get<number>('redis.port');
  const nodeEnv = config.get<string>('nodeEnv');

  logger.log('Queue worker starting...');
  logger.log(`Environment: ${nodeEnv}`);
  logger.log(`Redis connection: ${redisHost}:${redisPort}`);

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down gracefully...`);
    
    // Wait for current jobs to complete (max 30 seconds)
    // BullMQ will finish processing active jobs before closing
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await app.close();
    logger.log('Worker shut down complete');
    process.exit(0);
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log('Queue worker ready to process jobs');
}

bootstrap().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
