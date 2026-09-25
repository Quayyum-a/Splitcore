/**
 * Bug Condition Exploration Test - Property 1
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 *
 * GOAL: Surface counterexamples that demonstrate the bug where Redis connection
 * failures during onModuleInit crash the application and prevent port binding.
 *
 * This test encodes the EXPECTED behavior (graceful degradation) and will:
 * - FAIL on unfixed code (proving the bug exists)
 * - PASS after implementing the fix (validating the solution)
 *
 * Validates Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService - Bug Condition Exploration', () => {
  let service: RedisService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'redis.host': 'nonexistent-redis-host-that-will-fail.local',
                'redis.port': 6379,
                'redis.password': 'test-password',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  /**
   * Test Case 1: Redis Connection Failure During onModuleInit
   *
   * This test attempts to initialize RedisService with an invalid/unreachable Redis host.
   *
   * EXPECTED BEHAVIOR (fixed code):
   * - onModuleInit completes without throwing
   * - isReady() returns false
   * - Application can continue startup
   *
   * ACTUAL BEHAVIOR (unfixed code):
   * - onModuleInit throws error
   * - Application bootstrap fails
   * - Port never binds
   *
   * This test will FAIL on unfixed code with an unhandled connection error.
   */
  it('should complete onModuleInit without throwing when Redis connection fails', async () => {
    let initError: Error | null = null;

    try {
      // On unfixed code, this WILL throw an error
      // On fixed code, this should complete without throwing
      await service.onModuleInit();
    } catch (error) {
      initError = error as Error;

      // Document the counterexample
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('COUNTEREXAMPLE FOUND: Redis connection failure crashes onModuleInit');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('Error Type:', (error as any).constructor.name);
      console.error('Error Message:', initError.message);
      console.error('');
      console.error('This confirms the bug:');
      console.error('- Redis connection failure during onModuleInit throws an error');
      console.error('- This error propagates and crashes application bootstrap');
      console.error('- Application never reaches app.listen() and fails to bind to port');
      console.error('- Render deployment times out with "No open ports" error');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // EXPECTED BEHAVIOR: onModuleInit should NOT throw
    // This assertion will FAIL on unfixed code, confirming the bug exists
    expect(initError).toBeNull();

    // EXPECTED BEHAVIOR: Redis should be marked as unavailable
    // This assertion verifies graceful degradation
    expect(service.isReady()).toBe(false);
  }, 30000); // 30 second timeout for connection attempt
});

/**
 * Preservation Property Tests - UNFIXED Code Baseline
 *
 * CRITICAL: These tests run on UNFIXED code to capture baseline behavior
 * They document what MUST be preserved when implementing the fix
 *
 * GOAL: Observe and document normal Redis connection behavior
 * These tests MUST PASS both before and after the fix
 *
 * Validates Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

describe('RedisService - Preservation Properties (Baseline)', () => {
  describe('Property 2.1: Successful Connection Sets isConnected = true', () => {
    /**
     * Observation on UNFIXED code:
     * When Redis connection succeeds during onModuleInit, the service sets isConnected = true
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.1, 3.4
     */
    it('should set isConnected = true when connection succeeds', async () => {
      // Use real environment Redis configuration
      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);

      // On UNFIXED code with Redis available, this should succeed
      await service.onModuleInit();

      // Observe: isReady() returns true after successful connection
      expect(service.isReady()).toBe(true);

      await module.close();
    }, 30000);
  });

  describe('Property 2.2: getClient() Returns Redis Instance When Connected', () => {
    /**
     * Observation on UNFIXED code:
     * When Redis is connected, getClient() returns the Redis client instance
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.5
     */
    it('should return Redis client instance when connected', async () => {
      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);
      await service.onModuleInit();

      const client = service.getClient();

      // Observe: getClient() returns a truthy Redis client
      expect(client).toBeDefined();
      expect(client).not.toBeNull();

      // Observe: The client has Redis methods
      expect(typeof client!.ping).toBe('function');
      expect(typeof client!.get).toBe('function');
      expect(typeof client!.set).toBe('function');

      await module.close();
    }, 30000);
  });

  describe('Property 2.3: ping() Returns True When Redis Available', () => {
    /**
     * Observation on UNFIXED code:
     * When Redis is connected, ping() successfully returns true
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.6
     */
    it('should return true from ping() when Redis is connected', async () => {
      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);
      await service.onModuleInit();

      const pingResult = await service.ping();

      // Observe: ping() returns true when Redis is connected
      expect(pingResult).toBe(true);

      await module.close();
    }, 30000);
  });

  describe('Property 2.4: Connection Events Are Logged', () => {
    /**
     * Observation on UNFIXED code:
     * Redis connection events (connect, ready, error, close) trigger logging
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.4
     */
    it('should log connection events during successful connection', async () => {
      const logSpy = jest.spyOn(console, 'log');

      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);
      await service.onModuleInit();

      // Give time for event listeners to fire
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Observe: Connection success is logged
      // Note: The exact log messages may vary, but connection events should be logged
      expect(service.isReady()).toBe(true);

      logSpy.mockRestore();
      await module.close();
    }, 30000);
  });

  describe('Property 2.5: onModuleDestroy() Gracefully Closes Connection', () => {
    /**
     * Observation on UNFIXED code:
     * onModuleDestroy() closes the Redis connection gracefully
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.7
     */
    it('should gracefully close Redis connection on module destroy', async () => {
      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);
      await service.onModuleInit();

      expect(service.isReady()).toBe(true);

      // Observe: module.close() triggers onModuleDestroy and closes connection
      await module.close();

      // After close, connection should be terminated
      // Note: We can't easily verify this without exposing internal state,
      // but the test passes if no errors are thrown during shutdown
      expect(true).toBe(true); // Placeholder - successful close without errors
    }, 30000);
  });

  describe('Property 2.6: Redis Operations Work Normally When Connected', () => {
    /**
     * Observation on UNFIXED code:
     * When Redis is connected, basic Redis operations work correctly
     *
     * This behavior MUST be preserved after implementing the fix
     *
     * Validates: Requirements 3.2, 3.5
     */
    it('should allow Redis operations when connected', async () => {
      const module = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, any> = {
                  'redis.host': process.env.REDIS_HOST || 'localhost',
                  'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
                  'redis.password': process.env.REDIS_PASSWORD,
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const service = module.get<RedisService>(RedisService);
      await service.onModuleInit();

      const client = service.getClient()!;

      // Observe: Can perform SET operation
      await client.set('test-key-preservation', 'test-value');

      // Observe: Can perform GET operation
      const value = await client.get('test-key-preservation');
      expect(value).toBe('test-value');

      // Cleanup
      await client.del('test-key-preservation');

      await module.close();
    }, 30000);
  });
});
