import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// A single shared ioredis connection, separate from the connection(s)
// BullMQ manages internally for its queues. This one is for anything else
// that needs Redis directly later — rate limiting, caching, idempotency
// locks — without every consumer opening its own socket.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisClient');
        const client = new Redis({
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          // BullMQ's own connections set this themselves, but a shared
          // general-purpose client benefits from limited retry attempts
          // so a persistently-unreachable Redis fails loudly instead of
          // retrying forever in the background.
          maxRetriesPerRequest: 3,
        });

        client.on('connect', () => logger.log('Connected to Redis'));
        client.on('error', (err) => logger.error(`Redis connection error: ${err.message}`));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor() {}

  onModuleDestroy() {
    // Individual providers close their own connections via their factory
    // scope; Nest handles this automatically for most cases. Left explicit
    // here as a reminder that Redis connections are a resource, not a
    // free singleton, when this module grows.
  }
}
