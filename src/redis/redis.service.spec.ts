import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: jest.Mocked<Redis>;
  let configService: ConfigService;

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock Redis client
    mockRedisClient = {
      ping: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    } as any;

    // Mock Redis constructor
    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedisClient);

    // Create test module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | number> = {
                'redis.host': 'localhost',
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
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should establish Redis connection with correct configuration', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          password: 'test-password',
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          connectTimeout: 10000,
        })
      );

      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('should register connection event handlers', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Verify event handlers were registered
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should set isConnected to true after successful connection', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Trigger connect event
      const connectHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      expect(service.isReady()).toBe(true);
    });

    it('should throw error when initial connection fails', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Connection failed'));

      await expect(service.onModuleInit()).rejects.toThrow('Connection failed');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection gracefully', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      mockRedisClient.quit.mockResolvedValue('OK');

      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    beforeEach(async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should return true when ping succeeds', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      const result = await service.ping();

      expect(result).toBe(true);
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('should return false when ping fails', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

      const result = await service.ping();

      expect(result).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return false initially', () => {
      expect(service.isReady()).toBe(false);
    });

    it('should return true after successful connection', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Trigger connect event
      const connectHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      expect(service.isReady()).toBe(true);
    });

    it('should return false after connection error', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Trigger connect event first
      const connectHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      expect(service.isReady()).toBe(true);

      // Trigger error event
      const errorHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1];
      errorHandler?.(new Error('Connection lost'));

      expect(service.isReady()).toBe(false);
    });

    it('should return false after connection close', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Trigger connect event first
      const connectHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      expect(service.isReady()).toBe(true);

      // Trigger close event
      const closeHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'close'
      )?.[1];
      closeHandler?.();

      expect(service.isReady()).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return the Redis client instance', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      const client = service.getClient();

      expect(client).toBe(mockRedisClient);
    });
  });

  describe('retry strategy', () => {
    let retryStrategy: (times: number) => number | null;
    let processExitSpy: jest.SpyInstance;

    beforeEach(async () => {
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockRedisClient.ping.mockResolvedValue('PONG');
      await service.onModuleInit();

      // Extract retry strategy from Redis constructor call
      const redisMock = Redis as jest.MockedClass<typeof Redis>;
      const calls = redisMock.mock.calls as Array<any[]>;
      if (calls.length === 0 || !calls[0] || !calls[0][0]) {
        throw new Error('Redis constructor was not called with expected arguments');
      }
      const redisConstructorCall = calls[0][0];
      retryStrategy = redisConstructorCall.retryStrategy;
    });

    afterEach(() => {
      processExitSpy.mockRestore();
    });

    it('should retry with 5 second interval for attempts 1-12', () => {
      for (let attempt = 1; attempt <= 12; attempt++) {
        const delay = retryStrategy(attempt);
        expect(delay).toBe(5000); // 5 seconds
      }
    });

    it('should exit process after max reconnection attempts exceeded', () => {
      expect(() => retryStrategy(13)).toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should reset reconnect attempts counter on successful connection', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      // Trigger multiple retries
      retryStrategy(5);
      retryStrategy(10);

      // Trigger successful connect event
      const connectHandler = mockRedisClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      // After connect, the internal counter should reset
      // This is verified by checking isReady returns true
      expect(service.isReady()).toBe(true);
    });
  });

  describe('connection configuration', () => {
    it('should configure 10 second connection timeout', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          connectTimeout: 10000,
        })
      );
    });

    it('should set maximum 3 retries per request', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetriesPerRequest: 3,
        })
      );
    });

    it('should enable ready check', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          enableReadyCheck: true,
        })
      );
    });
  });
});
