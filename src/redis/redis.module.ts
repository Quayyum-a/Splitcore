import { Global, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// A single shared ioredis connection, separate from the connection(s)
// BullMQ manages internally for its queues. This one is for anything else
// that needs Redis directly — rate limiting, caching, idempotency locks —
// without every consumer opening its own socket.
//
// RedisService owns the connection: bounded startup, background reconnect,
// graceful shutdown, and the REDIS_ENABLED=false mode in which no socket is
// opened at all.
@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisService],
      // Null when REDIS_ENABLED=false. Consumers must handle that — the
      // health check is the only one today, and it does.
      useFactory: (redisService: RedisService): Redis | null => redisService.getClient(),
    },
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
