import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// A single shared ioredis connection, separate from the connection(s)
// BullMQ manages internally for its queues. This one is for anything else
// that needs Redis directly later — rate limiting, caching, idempotency
// locks — without every consumer opening its own socket.
//
// Now managed by RedisService with proper retry logic, connection event
// logging, and graceful shutdown handling.
@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisService],
      useFactory: (redisService: RedisService) => {
        return redisService.getClient();
      },
    },
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
