import { Logger } from '@nestjs/common';

/**
 * Stand-in for a BullMQ Queue when REDIS_ENABLED=false.
 *
 * It accepts jobs and drops them, which is only safe because every producer
 * in this codebase treats enqueueing as best-effort on top of durable
 * database state:
 *
 * - payouts are committed as QUEUED rows before they are enqueued, so the
 *   sweep picks them up once a worker exists;
 * - webhook events are stored before they are enqueued, and WebhooksService
 *   processes them inline in this mode rather than relying on the queue.
 *
 * Nothing is silently lost; it is deferred. Dropping a job here is still
 * worth a log line, so an unexpected producer shows up in the logs instead
 * of vanishing.
 */
export class NullQueue {
  private readonly logger = new Logger(NullQueue.name);

  constructor(readonly name: string) {}

  async add(jobName: string, data: unknown, _opts?: unknown): Promise<{ id: string }> {
    this.logger.debug(
      `Redis disabled; dropped '${jobName}' on queue '${this.name}': ${JSON.stringify(data)}`,
    );
    return { id: 'null-queue' };
  }

  async upsertJobScheduler(
    schedulerId: string,
    _repeat: unknown,
    _template?: unknown,
  ): Promise<void> {
    this.logger.warn(
      `Redis disabled; repeatable job '${schedulerId}' was not scheduled on '${this.name}'`,
    );
  }

  async close(): Promise<void> {
    // Nothing to close.
  }
}
