// Import instrument.ts first for Sentry initialization
import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { WorkerModule } from './worker/worker.module';

/**
 * Queue worker entry point.
 *
 * This process runs independently from the API server (src/main.ts).
 * It connects to Redis and processes background jobs from BullMQ queues.
 *
 * The worker does NOT start an HTTP server - it only processes jobs.
 *
 * Deployment:
 * - On Render: Deployed as a separate "Worker" service
 * - Locally: Run with `npm run start:worker:dev`
 */
async function bootstrap() {
  // Create application context (no HTTP server)
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  // Attach pino logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Get configuration
  const config = app.get(ConfigService);

  const redisHost = config.get<string>('redis.host');
  const redisPort = config.get<number>('redis.port');
  const nodeEnv = config.get<string>('nodeEnv');

  logger.log('Queue worker starting...');
  logger.log(`Environment: ${nodeEnv}`);

  // There is nothing for a worker to do without a queue to read from.
  // Exiting 0 rather than crash-looping makes the reason obvious in the
  // deploy log instead of burying it under restart noise.
  if (config.get<boolean>('redis.enabled') === false) {
    logger.error(
      'REDIS_ENABLED=false — a queue worker cannot run without Redis. ' +
        'Set REDIS_ENABLED=true (and a reachable REDIS_HOST) to start the worker, ' +
        'or suspend this service while the API runs in inline mode.',
    );
    await app.close();
    process.exit(0);
  }

  logger.log(`Redis connection: ${redisHost}:${redisPort}`);

  // Graceful shutdown.
  //
  // app.close() runs Nest's shutdown hooks, which close the BullMQ workers;
  // closing a worker waits for its in-flight jobs to finish. So the wait is
  // exactly as long as the work takes — never a fixed sleep, which would
  // burn the platform's whole SIGTERM grace period on an idle worker and
  // get the process SIGKILLed before it ever closed.
  const SHUTDOWN_TIMEOUT_MS = 25000; // under Render's 30s SIGKILL deadline
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received, finishing in-flight jobs...`);

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS).unref(),
    );

    try {
      const outcome = await Promise.race([app.close().then(() => 'closed' as const), timeout]);
      if (outcome === 'timeout') {
        logger.warn(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; exiting with jobs still active`);
      } else {
        logger.log('Worker shut down complete');
      }
    } catch (error) {
      logger.error(`Error during shutdown: ${(error as Error).message}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('Queue worker ready to process jobs');
}

bootstrap().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
