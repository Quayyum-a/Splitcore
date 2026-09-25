import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis; // Initialized in onModuleInit
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 12; // 12 attempts = 60 seconds
  private readonly reconnectInterval = 5000; // 5 seconds

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      await this.connect();
    } catch (error) {
      this.logger.warn(
        `Redis connection failed during startup: ${(error as Error).message}. Application will continue with Redis unavailable.`,
      );
      this.isConnected = false;
      // Do not re-throw - allow application to continue without Redis
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  private async connect(): Promise<void> {
    const host = this.configService.get<string>('redis.host')!;
    const port = this.configService.get<number>('redis.port')!;
    const password = this.configService.get<string>('redis.password');

    this.logger.log(`Connecting to Redis at ${host}:${port}...`);

    this.client = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000, // 10 second connection timeout
      // Enable TLS for Upstash and other cloud Redis providers
      tls: password ? {} : undefined,
      retryStrategy: (times: number) => {
        if (times > this.maxReconnectAttempts) {
          this.logger.error(
            `Failed to connect to Redis after ${this.maxReconnectAttempts} attempts. Exiting...`,
          );
          process.exit(1);
        }
        const delay = this.reconnectInterval;
        this.logger.warn(
          `Reconnecting to Redis... (attempt ${times}/${this.maxReconnectAttempts})`,
        );
        return delay;
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connection established');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
    });

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.isConnected = false;
    });

    // Wait for initial connection
    try {
      await this.client.ping();
      this.logger.log('Redis ping successful');
    } catch (error) {
      this.logger.error('Redis initial connection failed:', error);
      throw error;
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis ping failed', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }
}
