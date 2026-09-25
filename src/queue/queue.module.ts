import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { NullQueue } from './null-queue';

export const DIAGNOSTICS_QUEUE = 'diagnostics';
export const WEBHOOKS_QUEUE = 'webhooks';
export const PAYOUTS_QUEUE = 'payouts';
export const RECONCILIATION_QUEUE = 'reconciliation';

export const QUEUE_NAMES = [
  DIAGNOSTICS_QUEUE,
  WEBHOOKS_QUEUE,
  PAYOUTS_QUEUE,
  RECONCILIATION_QUEUE,
] as const;

// Decided here, at module-definition time: whether BullMQ exists at all is a
// property of the module's shape, which Nest needs before the DI container
// (and so before ConfigService) is available. Reading process.env directly
// is the only option, and a single boolean is safe to read that way.
const REDIS_ENABLED = configuration().redis.enabled;

const bullImports = [
  BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      connection: {
        // Host and TLS come from configuration.ts, which normalizes a
        // provider connection URL down to the bare host ioredis needs.
        host: config.get<string>('redis.host'),
        port: config.get<number>('redis.port'),
        password: config.get<string>('redis.password'),
        tls: config.get<boolean>('redis.tls') ? {} : undefined,
        // BullMQ requires this to be null: a blocking command that gave up
        // after N retries would kill the worker's job loop.
        maxRetriesPerRequest: null,
      },
    }),
  }),
  BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
];

// Same injection tokens, so no consumer knows the difference.
const nullQueueProviders = QUEUE_NAMES.map((name) => ({
  provide: getQueueToken(name),
  useValue: new NullQueue(name),
}));

/**
 * QueueModule configures BullMQ connections and registers queues.
 *
 * Imported by BOTH AppModule (the API, which enqueues) and WorkerModule (the
 * worker, which consumes). It deliberately does NOT include processors:
 * those live in QueueProcessorsModule, imported only by WorkerModule, so the
 * API can never accidentally start consuming jobs.
 *
 * When REDIS_ENABLED=false, BullMQ is never constructed and NullQueue stubs
 * take its place — so nothing in the process opens a Redis socket, and a
 * deploy cannot be held up by a Redis that is down or over quota.
 */
@Module({
  imports: REDIS_ENABLED ? bullImports : [],
  providers: REDIS_ENABLED ? [] : nullQueueProviders,
  exports: REDIS_ENABLED ? [BullModule] : nullQueueProviders.map((provider) => provider.provide),
})
export class QueueModule {}
