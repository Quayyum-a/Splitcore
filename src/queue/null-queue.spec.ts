/**
 * Unit tests for the queue stub used when REDIS_ENABLED=false, and for the
 * module shape that selects it.
 */

import { getQueueToken } from '@nestjs/bullmq';
import { NullQueue } from './null-queue';
import { PAYOUTS_QUEUE, QUEUE_NAMES, WEBHOOKS_QUEUE } from './queue.module';

describe('NullQueue', () => {
  it('accepts a job and resolves, so producers need no special case', async () => {
    const queue = new NullQueue(PAYOUTS_QUEUE);

    await expect(queue.add('process-payout', { payoutId: 'p1' })).resolves.toEqual({
      id: 'null-queue',
    });
  });

  it('accepts job options without inspecting them', async () => {
    const queue = new NullQueue(WEBHOOKS_QUEUE);

    await expect(
      queue.add('process-webhook', { webhookEventId: 'evt-1' }, { jobId: 'webhook:evt-1' }),
    ).resolves.toBeDefined();
  });

  it('resolves upsertJobScheduler, so worker bootstrap does not fail', async () => {
    const queue = new NullQueue(PAYOUTS_QUEUE);

    await expect(
      queue.upsertJobScheduler('payout-sweep', { every: 1000 }),
    ).resolves.toBeUndefined();
  });

  it('closes cleanly', async () => {
    await expect(new NullQueue(PAYOUTS_QUEUE).close()).resolves.toBeUndefined();
  });

  it('remembers which queue it stands in for', () => {
    expect(new NullQueue(WEBHOOKS_QUEUE).name).toBe(WEBHOOKS_QUEUE);
  });
});

describe('queue registration', () => {
  it('covers every queue the application enqueues onto', () => {
    // A queue missing here would be injected as undefined at runtime rather
    // than failing at startup.
    expect([...QUEUE_NAMES]).toEqual(
      expect.arrayContaining(['diagnostics', 'webhooks', 'payouts', 'reconciliation']),
    );
  });

  it('uses the same injection tokens as BullMQ, so no consumer changes', () => {
    expect(getQueueToken(WEBHOOKS_QUEUE)).toBe(getQueueToken('webhooks'));
  });
});
