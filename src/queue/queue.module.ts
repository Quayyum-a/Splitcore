import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DiagnosticsProcessor } from './diagnostics.processor';

export const DIAGNOSTICS_QUEUE = 'diagnostics';

// Registers the shared BullMQ connection once, globally, so every future
// queue (webhook processing, payout retries, reconciliation jobs) just
// declares itself with BullModule.registerQueue() without repeating Redis
// connection details.
//
// The "diagnostics" queue below isn't a real business queue — it exists so
// Phase 1 has one working end-to-end example (enqueue -> process) that
// later phases can copy the shape of, and so this module is provably
// exercised rather than just present.
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          tls: {},
        },
      }),
    }),
    BullModule.registerQueue({
      name: DIAGNOSTICS_QUEUE,
    }),
  ],
  providers: [DiagnosticsProcessor],
  exports: [BullModule],
})
export class QueueModule {}
