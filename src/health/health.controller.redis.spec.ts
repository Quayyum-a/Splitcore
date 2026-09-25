/**
 * Unit tests for the health check's Redis handling.
 *
 * Covers production-deployment-redis-fix task 4.2. Redis is a non-critical
 * dependency, so these pin the rule that /health reports its state without
 * ever failing the overall check.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

function configWith(redisEnabled: boolean): ConfigService {
  return { get: jest.fn(() => redisEnabled) } as unknown as ConfigService;
}

async function buildController(
  redis: Partial<Redis> | null,
  redisEnabled = true,
): Promise<{
  controller: HealthController;
  close: () => Promise<void>;
}> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockResolvedValue([{ x: 1 }]) } },
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: ConfigService, useValue: configWith(redisEnabled) },
    ],
  }).compile();

  return {
    controller: module.get(HealthController),
    close: () => module.close(),
  };
}

describe('HealthController Redis indicator', () => {
  it('reports "up" when Redis answers PONG', async () => {
    const { controller, close } = await buildController({
      ping: jest.fn().mockResolvedValue('PONG'),
    } as Partial<Redis>);

    const result = await controller.check();

    expect(result.details.redis).toEqual({ status: 'up' });
    expect(result.details.database.status).toBe('up');
    await close();
  });

  it('reports "down" with a reason when no client was injected', async () => {
    const { controller, close } = await buildController(null);

    const result = await controller.check();

    expect(result.details.redis).toEqual({
      status: 'down',
      message: 'Redis client not initialized',
    });
    await close();
  });

  it('reports "down" with the error message when PING throws', async () => {
    const { controller, close } = await buildController({
      ping: jest.fn().mockRejectedValue(new Error('Connection is closed.')),
    } as Partial<Redis>);

    const result = await controller.check();

    expect(result.details.redis).toEqual({
      status: 'down',
      message: 'Connection is closed.',
    });
    await close();
  });

  it('reports "down" when Redis answers something other than PONG', async () => {
    const { controller, close } = await buildController({
      ping: jest.fn().mockResolvedValue('LOADING'),
    } as Partial<Redis>);

    const result = await controller.check();

    expect(result.details.redis.status).toBe('down');
    await close();
  });

  it('keeps the overall check successful while Redis is down', async () => {
    // Render and any load balancer key off the HTTP status. Redis being
    // unavailable degrades queueing, it must not pull the instance out of
    // rotation, so check() resolves rather than throwing a 503.
    const { controller, close } = await buildController(null);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.error).toEqual({});
    await close();
  });

  it('reports the database as down without throwing when Postgres is unreachable', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockRejectedValue(new Error('P1001 unreachable')) },
        },
        { provide: REDIS_CLIENT, useValue: { ping: jest.fn().mockResolvedValue('PONG') } },
        { provide: ConfigService, useValue: configWith(true) },
      ],
    }).compile();

    const result = await module.get(HealthController).check();

    expect(result.details.database).toEqual({ status: 'down', message: 'P1001 unreachable' });
    await module.close();
  });

  describe('when Redis is switched off entirely', () => {
    it('omits the Redis indicator rather than reporting a permanent "down"', async () => {
      // A dependency that is not part of the deployment is not a dependency
      // to report; showing it as down forever trains people to ignore the
      // health check.
      const { controller, close } = await buildController(null, false);

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.details.database.status).toBe('up');
      expect(result.details.redis).toBeUndefined();
      await close();
    });
  });
});
