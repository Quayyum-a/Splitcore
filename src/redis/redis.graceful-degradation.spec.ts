/**
 * Unit tests for RedisService graceful degradation.
 *
 * Covers production-deployment-redis-fix task 4.1. These use a mocked
 * ioredis client so they assert behaviour, not network reachability, and
 * run in milliseconds regardless of whether a Redis is available.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

/** The ioredis constructor, as replaced by the jest.mock below. */
const RedisConstructor = Redis as unknown as jest.Mock;

type FakeClient = {
  status: string;
  on: jest.Mock;
  connect: jest.Mock;
  ping: jest.Mock;
  quit: jest.Mock;
  disconnect: jest.Mock;
  handlers: Record<string, (arg?: unknown) => void>;
};

let fake: FakeClient;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => fake),
}));

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const client: FakeClient = {
    status: 'wait',
    handlers,
    on: jest.fn((event: string, handler: (arg?: unknown) => void) => {
      handlers[event] = handler;
      return client;
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    ...overrides,
  };
  return client;
}

function configFor(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    'redis.enabled': true,
    'redis.host': 'localhost',
    'redis.port': 6379,
    'redis.password': undefined,
    'redis.tls': false,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('RedisService graceful degradation', () => {
  beforeEach(() => {
    fake = makeFakeClient();
    jest.clearAllMocks();
  });

  describe('getClient()', () => {
    it('returns a client immediately at construction, before onModuleInit', () => {
      // Nest resolves the REDIS_CLIENT factory before lifecycle hooks run.
      // A client created in onModuleInit would be injected as undefined.
      const service = new RedisService(configFor());
      expect(service.getClient()).toBe(fake);
    });

    it('still returns the client when the connection failed', async () => {
      fake.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const service = new RedisService(configFor());
      await service.onModuleInit();

      expect(service.getClient()).toBe(fake);
      expect(service.isReady()).toBe(false);
    });
  });

  describe('onModuleInit()', () => {
    it('connects, pings and reports ready on success', async () => {
      const service = new RedisService(configFor());
      fake.connect.mockImplementation(async () => {
        fake.status = 'ready';
        fake.handlers.ready?.();
      });

      await service.onModuleInit();

      expect(fake.connect).toHaveBeenCalledTimes(1);
      expect(fake.ping).toHaveBeenCalledTimes(1);
      expect(service.isReady()).toBe(true);
    });

    it('does not throw when the connection fails', async () => {
      fake.connect.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      const service = new RedisService(configFor());

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isReady()).toBe(false);
    });

    it('does not throw when PING fails after a successful connect', async () => {
      fake.ping.mockRejectedValue(new Error('PING failed: Network error'));
      const service = new RedisService(configFor());

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isReady()).toBe(false);
    });

    it('does not throw when the provider request quota is exhausted', async () => {
      // Upstash free tier: "ERR max requests limit exceeded".
      fake.ping.mockRejectedValue(new Error('ERR max requests limit exceeded. Limit: 500000'));
      const service = new RedisService(configFor());

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isReady()).toBe(false);
    });

    it('gives up quickly instead of blocking startup on an unresponsive Redis', async () => {
      // A connect that never settles must not hold up app.listen().
      fake.connect.mockImplementation(() => new Promise(() => {}));
      const service = new RedisService(configFor());

      const started = Date.now();
      await service.onModuleInit();

      expect(Date.now() - started).toBeLessThan(10000);
      expect(service.isReady()).toBe(false);
    }, 15000);
  });

  describe('isReady()', () => {
    it('is false before any connection attempt', () => {
      expect(new RedisService(configFor()).isReady()).toBe(false);
    });

    it('is false when the client reports a non-ready status', async () => {
      const service = new RedisService(configFor());
      fake.connect.mockImplementation(async () => {
        fake.status = 'ready';
        fake.handlers.ready?.();
      });
      await service.onModuleInit();
      expect(service.isReady()).toBe(true);

      // Socket dropped: status regresses even though nothing else changed.
      fake.status = 'reconnecting';
      expect(service.isReady()).toBe(false);
    });

    it('is false after a close event', async () => {
      const service = new RedisService(configFor());
      fake.connect.mockImplementation(async () => {
        fake.status = 'ready';
        fake.handlers.ready?.();
      });
      await service.onModuleInit();

      fake.handlers.close?.();
      expect(service.isReady()).toBe(false);
    });
  });

  describe('ping()', () => {
    it('returns true on PONG', async () => {
      const service = new RedisService(configFor());
      await expect(service.ping()).resolves.toBe(true);
    });

    it('returns false instead of throwing when Redis is unreachable', async () => {
      fake.ping.mockRejectedValue(new Error('Connection is closed.'));
      const service = new RedisService(configFor());
      await expect(service.ping()).resolves.toBe(false);
    });
  });

  describe('onModuleDestroy()', () => {
    it('quits cleanly when connected', async () => {
      const service = new RedisService(configFor());
      fake.connect.mockImplementation(async () => {
        fake.status = 'ready';
        fake.handlers.ready?.();
      });
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(fake.quit).toHaveBeenCalledTimes(1);
    });

    it('disconnects rather than waiting for a QUIT reply that will never come', async () => {
      fake.connect.mockRejectedValue(new Error('unreachable'));
      const service = new RedisService(configFor());
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(fake.quit).not.toHaveBeenCalled();
      expect(fake.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('TLS configuration', () => {
    it('enables TLS when redis.tls is set', () => {
      new RedisService(configFor({ 'redis.tls': true }));
      expect(RedisConstructor.mock.calls[0][0]).toMatchObject({ tls: {} });
    });

    it('leaves TLS off for a plain local Redis', () => {
      new RedisService(configFor({ 'redis.tls': false }));
      expect(RedisConstructor.mock.calls[0][0].tls).toBeUndefined();
    });
  });

  describe('when REDIS_ENABLED=false', () => {
    const disabled = () => configFor({ 'redis.enabled': false });

    it('never constructs an ioredis client', () => {
      const Redis = RedisConstructor;
      Redis.mockClear();

      new RedisService(disabled());

      expect(Redis).not.toHaveBeenCalled();
    });

    it('reports no client, so consumers can tell Redis apart from a null', () => {
      const service = new RedisService(disabled());

      expect(service.getClient()).toBeNull();
      expect(service.isEnabled()).toBe(false);
      expect(service.isReady()).toBe(false);
    });

    it('starts and stops without touching the network', async () => {
      const service = new RedisService(disabled());

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(fake.connect).not.toHaveBeenCalled();
      expect(fake.quit).not.toHaveBeenCalled();
      expect(fake.disconnect).not.toHaveBeenCalled();
    });

    it('reports ping() as false rather than throwing on a null client', async () => {
      const service = new RedisService(disabled());

      await expect(service.ping()).resolves.toBe(false);
    });

    it('distinguishes "switched off" from "unreachable"', async () => {
      const enabled = new RedisService(configFor());
      fake.connect.mockRejectedValue(new Error('unreachable'));
      await enabled.onModuleInit();

      expect(enabled.isEnabled()).toBe(true);
      expect(enabled.isReady()).toBe(false);
      expect(new RedisService(disabled()).isEnabled()).toBe(false);
    });
  });
});
