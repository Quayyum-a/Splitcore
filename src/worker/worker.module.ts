import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { validationSchema } from '../config/validation.schema';
import { LoggerModule } from '../common/logger/logger.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';

/**
 * WorkerModule is the root module for the queue worker process.
 * 
 * It imports all necessary modules for processing background jobs:
 * - ConfigModule: Environment configuration with validation
 * - LoggerModule: Structured logging via pino
 * - PrismaModule: Database access
 * - RedisModule: Redis connection for BullMQ
 * - QueueModule: Job processors and queue configuration
 * 
 * This module is used by src/worker.ts (worker entry point),
 * NOT src/main.ts (API server entry point).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
  ],
})
export class WorkerModule {}
