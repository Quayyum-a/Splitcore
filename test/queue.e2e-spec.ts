/**
 * E2E tests for queue processing (phase-1-production-ready task 22.1).
 *
 * Runs against a real Redis: jobs are enqueued through the API-side queue
 * connection and drained by a worker built the same way the worker process
 * builds them, so this exercises the actual BullMQ wiring rather than a mock.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue, Worker } from 'bullmq';
import { AppModule } from '../src/app.module';
import { DIAGNOSTICS_QUEUE, WEBHOOKS_QUEUE } from '../src/queue/queue.module';
import { parseRedisHost } from '../src/config/configuration';

jest.setTimeout(30000);

describe('Queue processing (e2e)', () => {
  let app: INestApplication;
  let diagnostics: Queue;
  let webhooks: Queue;
  const workers: Worker[] = [];

  const connection = (() => {
    const { host, tlsFromScheme } = parseRedisHost(process.env.REDIS_HOST);
    const password = process.env.REDIS_PASSWORD || undefined;
    return {
      host,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password,
      tls: tlsFromScheme || password ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  })();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    diagnostics = app.get<Queue>(getQueueToken(DIAGNOSTICS_QUEUE));
    webhooks = app.get<Queue>(getQueueToken(WEBHOOKS_QUEUE));
  });

  afterAll(async () => {
    await diagnostics?.obliterate({ force: true }).catch(() => undefined);
    await webhooks?.obliterate({ force: true }).catch(() => undefined);
    await app.close();
  });

  afterEach(async () => {
    // A worker left running would drain the next test's jobs before that
    // test ever looked at the queue.
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await diagnostics.obliterate({ force: true }).catch(() => undefined);
  });

  /** Drains `queueName` with `handler` and resolves once `count` jobs finish. */
  function drain<T>(
    queueName: string,
    handler: (job: Job<T>) => Promise<unknown>,
    count = 1,
  ): Promise<Job<T>[]> {
    return new Promise((resolve, reject) => {
      const seen: Job<T>[] = [];
      const worker = new Worker<T>(queueName, handler, { connection, prefix: 'bull' });
      workers.push(worker);
      worker.on('completed', (job) => {
        seen.push(job as Job<T>);
        if (seen.length >= count) resolve(seen);
      });
      worker.on('error', reject);
    });
  }

  it('round-trips a job from the API connection to a worker', async () => {
    const drained = drain<{ pingedAt: string }>(DIAGNOSTICS_QUEUE, async (job) => ({
      echoed: job.data.pingedAt,
    }));

    const pingedAt = new Date().toISOString();
    await diagnostics.add('ping', { pingedAt });

    const [job] = await drained;
    expect(job.data.pingedAt).toBe(pingedAt);
  });

  it('reports queue health through the shared connection', async () => {
    await expect(diagnostics.getJobCounts()).resolves.toEqual(
      expect.objectContaining({ waiting: expect.any(Number) }),
    );
  });

  it('dedupes by job id, so the same unit of work is never queued twice', async () => {
    // Settlement and the payout sweep both rely on this: enqueuing a payout
    // that is already waiting must be a no-op.
    await diagnostics.add('ping', { pingedAt: 'first' }, { jobId: 'dedupe-me' });
    await diagnostics.add('ping', { pingedAt: 'second' }, { jobId: 'dedupe-me' });

    const waiting = await diagnostics.getWaiting();
    expect(waiting.filter((job) => job.id === 'dedupe-me')).toHaveLength(1);
  });

  it('retries a failing job before giving up', async () => {
    let attempts = 0;
    const drained = drain(DIAGNOSTICS_QUEUE, async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient failure');
      return { ok: true };
    });

    await diagnostics.add(
      'ping',
      { pingedAt: new Date().toISOString() },
      { attempts: 5, backoff: { type: 'fixed', delay: 10 } },
    );

    await drained;
    expect(attempts).toBe(3);
  });

  it('keeps a delayed job out of the waiting set until it is due', async () => {
    await diagnostics.add('ping', { pingedAt: 'later' }, { delay: 60000 });

    expect(await diagnostics.getDelayedCount()).toBe(1);
    expect(await diagnostics.getWaitingCount()).toBe(0);
  });

  it('registers every queue the application enqueues onto', async () => {
    expect(diagnostics.name).toBe(DIAGNOSTICS_QUEUE);
    expect(webhooks.name).toBe(WEBHOOKS_QUEUE);
  });
});
