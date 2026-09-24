import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const DIAGNOSTICS_QUEUE = 'diagnostics';

/**
 * QueueModule configures BullMQ connection and registers queues.
 *
 * This module is imported by BOTH:
 * - AppModule (API server): Needs queue connection to enqueue jobs
 * - WorkerModule (worker process): Needs queue connection to process jobs
 *
 * IMPORTANT: This module does NOT include processors.
 * Processors are registered separately in QueueProcessorsModule,
 * which is ONLY imported by WorkerModule.
 *
 * This separation prevents the API server from accidentally starting workers.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('redis.password');

        return {
          connection: {
            host: config.get<string>('redis.host'),
            port: config.get<number>('redis.port'),
            password,
            // Enable TLS for cloud Redis providers (Upstash, Redis Cloud, etc.)
            // Upstash requires TLS even on port 6379
            tls: password ? {} : undefined,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: DIAGNOSTICS_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
