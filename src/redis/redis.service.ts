import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { withTimeout } from '../common/utils/with-timeout';

/** Startup must not block on an unreachable Redis; see onModuleInit. */
const STARTUP_CONNECT_TIMEOUT_MS = 5000;

/**
 * Shared Redis connection with graceful degradation.
 *
 * Redis is a non-critical dependency: it backs queueing and caching, not the
 * request path that accepts money. So nothing here throws during startup.
 * If Redis is unreachable the process still boots, binds its port, and serves
 * HTTP with Redis-dependent features degraded until the connection is restored.
 *
 * Two details matter and are easy to get wrong:
 *
 * 1. The client is built in the constructor, not in onModuleInit. Nest
 *    resolves provider factories (REDIS_CLIENT) BEFORE lifecycle hooks run,
 *    so a client created in onModuleInit would be injected as `undefined`
 *    everywhere, forever.
 * 2. The initial connect is bounded by STARTUP_CONNECT_TIMEOUT_MS. ioredis
 *    retries internally, and an unbounded wait here delays app.listen() past
 *    the platform's deploy health-check window ("No open ports" on Render).
 *
 * Consumers should check isReady() before assuming Redis is usable:
 *
 *   if (redisService.isReady()) await redisService.getClient().set(k, v);
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** Null when REDIS_ENABLED=false: no socket is ever opened. */
  private readonly client: Redis | null;
  private readonly enabled: boolean;
  private isConnected = false;
  private destroyed = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 12; // 12 attempts x 5s = 60 seconds
  private readonly reconnectInterval = 5000;

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('redis.enabled') ?? true;
    if (!this.enabled) {
      this.client = null;
      this.logger.warn(
        'REDIS_ENABLED=false — running without Redis. Background queueing is ' +
          'disabled; webhook events are processed inline on the request.',
      );
      return;
    }

    const host = this.configService.get<string>('redis.host')!;
    const port = this.configService.get<number>('redis.port')!;
    const password = this.configService.get<string>('redis.password');
    const tls = this.configService.get<boolean>('redis.tls') ?? Boolean(password);

    this.logger.log(`Redis client configured for ${host}:${port} (tls=${tls})`);

    this.client = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: STARTUP_CONNECT_TIMEOUT_MS,
      // Nothing connects until onModuleInit calls connect(), which keeps
      // constructor-time DI free of I/O and side effects.
      lazyConnect: true,
      // Fail commands fast while disconnected instead of queueing them
      // forever; callers gate on isReady() and degrade.
      enableOfflineQueue: false,
      tls: tls ? {} : undefined,
      // Bounded: give up reconnecting rather than crash or spin forever.
      // scheduleReconnect() re-arms a fresh attempt cycle later.
      retryStrategy: (times: number) => {
        if (this.destroyed || times > this.maxReconnectAttempts) {
          return null;
        }
        return this.reconnectInterval;
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connection established');
      this.reconnectAttempts = 0;
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
      this.isConnected = true;
    });

    // Errors are expected while degraded; logging at warn keeps an
    // unreachable Redis from flooding error reporting.
    this.client.on('error', (error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });

    this.client.on('end', () => {
      this.isConnected = false;
      if (!this.destroyed) {
        this.logger.warn(
          'Redis connection ended. Redis-dependent features are unavailable until it is restored.',
        );
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Attempts the initial connection. Never throws: a failure here degrades
   * Redis-dependent features, it does not stop the application from starting.
   */
  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.tryConnect();
    if (!this.isConnected) {
      this.scheduleReconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (!this.client) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      // quit() waits for a reply, which never arrives if we were never
      // connected; disconnect() is the right close for that case.
      if (this.client.status === 'ready') {
        await withTimeout(this.client.quit(), STARTUP_CONNECT_TIMEOUT_MS);
      } else {
        this.client.disconnect();
      }
      this.logger.log('Redis connection closed');
    } catch (error) {
      this.client.disconnect();
      this.logger.warn(`Redis did not close cleanly: ${(error as Error).message}`);
    }
  }

  /**
   * The shared ioredis client — a real instance whenever Redis is enabled,
   * so it is safe to inject at DI time. Null only when REDIS_ENABLED=false.
   * It may be disconnected, so gate writes on isReady() or handle the
   * rejection.
   */
  getClient(): Redis | null {
    return this.client;
  }

  /** False when Redis is switched off entirely, as opposed to unreachable. */
  isEnabled(): boolean {
    return this.enabled;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (error) {
      this.logger.warn(`Redis ping failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * True only when the client exists AND has completed a ready handshake.
   * False during startup failures, reconnection, and after shutdown.
   */
  isReady(): boolean {
    return this.client !== null && this.isConnected && this.client.status === 'ready';
  }

  /** One bounded connect + ping. Resolves either way; never rejects. */
  private async tryConnect(): Promise<void> {
    if (this.destroyed || !this.client) return;
    if (this.client.status === 'ready') {
      this.isConnected = true;
      return;
    }
    if (this.client.status === 'connecting' || this.client.status === 'reconnecting') {
      return;
    }

    try {
      await withTimeout(this.client.connect(), STARTUP_CONNECT_TIMEOUT_MS);
      await withTimeout(this.client.ping(), STARTUP_CONNECT_TIMEOUT_MS);
      this.isConnected = true;
      this.logger.log('Redis ping successful');
    } catch (error) {
      this.isConnected = false;
      const message = (error as Error).message;
      // Upstash's monthly request cap surfaces here; name it so the log is
      // actionable rather than just "connection failed".
      const hint = /max requests limit exceeded/i.test(message)
        ? ' Redis request quota is exhausted — check the provider dashboard.'
        : '';
      this.logger.warn(
        `Redis unavailable at startup: ${message}.${hint} The application will continue; ` +
          'Redis-dependent features (queueing, caching) are degraded until the connection is restored.',
      );
    }
  }

  /** Re-arm a bounded retry cycle after a failed or lost connection. */
  private scheduleReconnect(): void {
    if (this.destroyed || !this.client || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Giving up on Redis after ${this.maxReconnectAttempts} attempts. ` +
          'Restart the process once Redis is reachable.',
      );
      return;
    }

    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.tryConnect().then(() => {
        if (!this.isConnected) this.scheduleReconnect();
      });
    }, this.reconnectInterval);
    // Never hold the event loop open for a retry — the process (and Jest)
    // must be able to exit while Redis is down.
    this.reconnectTimer.unref();
  }
}
