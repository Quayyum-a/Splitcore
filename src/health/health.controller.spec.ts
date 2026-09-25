/**
 * Health Controller Preservation Tests - UNFIXED Code Baseline
 *
 * CRITICAL: These tests run on UNFIXED code to capture baseline behavior
 * They document what MUST be preserved when implementing the Redis graceful degradation fix
 *
 * GOAL: Observe and document health check behavior when Redis is available
 * These tests MUST PASS both before and after the fix
 *
 * **Validates: Requirements 3.3**
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

describe('HealthController - Preservation Properties (Baseline)', () => {
  let controller: HealthController;
  let module: TestingModule;
  let redis: Redis;

  beforeAll(async () => {
    // Create a real Redis connection for baseline testing
    let host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379');
    const password = process.env.REDIS_PASSWORD;

    // Remove https:// prefix if present (Upstash URLs include it but ioredis doesn't need it)
    host = host.replace(/^https?:\/\//, '');

    redis = new Redis({
      host,
      port,
      password,
      tls: password ? {} : undefined,
      connectTimeout: 15000,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      await redis.ping(); // Ensure Redis is connected
    } catch (error) {
      console.error('Failed to connect to Redis in test setup:', error);
      throw error;
    }

    module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(async (indicators) => {
              // Execute all health indicators and aggregate results
              const results = await Promise.all(indicators.map((fn: any) => fn()));
              const aggregated = results.reduce((acc, result) => ({ ...acc, ...result }), {});

              // Determine overall status
              const allUp = Object.values(aggregated).every(
                (indicator: any) => indicator.status === 'up',
              );

              return {
                status: allUp ? 'ok' : 'error',
                info: aggregated,
                error: {},
                details: aggregated,
              };
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
        {
          provide: REDIS_CLIENT,
          useValue: redis,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  }, 30000);

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
    if (module) {
      await module.close();
    }
  }, 30000);

  describe('Property 2.7: Health Check Reports Redis "up" When Available', () => {
    /**
     * Observation on UNFIXED code:
     * When Redis is available and connected, the health check endpoint reports Redis as "up"
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.3
     */
    it('should report Redis status as "up" when Redis is connected', async () => {
      // On UNFIXED code with Redis available, health check should succeed
      const result = await controller.check();

      // Observe: Overall health check status is "ok"
      expect(result.status).toBe('ok');

      // Observe: Database is reported as "up"
      expect(result.details.database).toBeDefined();
      expect(result.details.database.status).toBe('up');

      // Observe: Redis is reported as "up"
      expect(result.details.redis).toBeDefined();
      expect(result.details.redis.status).toBe('up');

      // Observe: No errors in the health check
      expect(result.error).toEqual({});
    }, 30000);

    /**
     * Observation on UNFIXED code:
     * When Redis ping returns PONG, the status is "up"
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.3, 3.6
     */
    it('should detect PONG response from Redis and mark as up', async () => {
      const result = await controller.check();

      expect(result.details.redis.status).toBe('up');

      // Verify Redis is actually responding
      const directPing = await redis.ping();
      expect(directPing).toBe('PONG');
    }, 30000);
  });
});
