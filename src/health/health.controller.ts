import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Public, unauthenticated, and deliberately boring. This is what a load
// balancer or an uptime monitor hits every few seconds — it should say
// "database reachable, Redis reachable" and nothing more.
//
// @SkipThrottle() exempts this endpoint from the default rate limit so
// health checks from Render, monitoring tools, and load balancers — which
// poll every few seconds from one address — don't get throttled.
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly redisEnabled: boolean;

  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    // Nullable by contract: null whenever REDIS_ENABLED=false, and a health
    // check must never be the thing that takes the service down.
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    configService: ConfigService,
  ) {
    this.redisEnabled = configService.get<boolean>('redis.enabled') ?? true;
  }

  @Get()
  @Public()
  @SkipThrottle()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check',
    description: 'Check the health status of the API, database, and Redis',
  })
  @ApiResponse({ status: 200, description: 'All systems operational' })
  @ApiResponse({
    status: 503,
    description: 'Service unavailable - one or more dependencies are down',
  })
  check() {
    const indicators: Array<() => Promise<HealthIndicatorResult>> = [() => this.checkDatabase()];

    // Report Redis only when it is part of this deployment. Permanently
    // showing a switched-off dependency as "down" trains everyone to ignore
    // the health check.
    if (this.redisEnabled) {
      indicators.push(() => this.checkRedis());
    }

    return this.health.check(indicators);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (error) {
      return { database: { status: 'down', message: (error as Error).message } };
    }
  }

  /**
   * Redis is a non-critical dependency: queueing and caching degrade without
   * it, but the API still serves traffic. So this reports "down" and never
   * throws — the overall check stays 200 and the platform keeps the instance
   * in rotation, while the detail shows an operator what is broken.
   */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    if (!this.redis) {
      return { redis: { status: 'down', message: 'Redis client not initialized' } };
    }
    try {
      const pong = await this.redis.ping();
      return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
    } catch (error) {
      return { redis: { status: 'down', message: (error as Error).message } };
    }
  }
}
