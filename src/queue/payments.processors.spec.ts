/**
 * Unit tests for the BullMQ adapters. They are deliberately thin — the logic
 * lives in services — so these check only that each job reaches the right
 * one and that failures propagate for BullMQ to retry.
 */

import { Job } from 'bullmq';
import { WebhookEventHandler } from '../webhooks/webhook-event-handler.service';
import { PayoutsService } from '../payouts/payouts.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  PAYOUT_SWEEP_JOB,
  PayoutsProcessor,
  RECONCILE_JOB,
  ReconciliationProcessor,
  WebhooksProcessor,
} from './payments.processors';

const job = <T>(data: T, name = 'job') => ({ data, name }) as Job<T>;

describe('WebhooksProcessor', () => {
  it('hands the stored event id to the handler', async () => {
    const handler = { handle: jest.fn().mockResolvedValue(undefined) };
    const processor = new WebhooksProcessor(handler as unknown as WebhookEventHandler);

    await processor.process(job({ webhookEventId: 'evt-1' }));

    expect(handler.handle).toHaveBeenCalledWith('evt-1');
  });

  it('lets a failure propagate so BullMQ retries the job', async () => {
    const handler = { handle: jest.fn().mockRejectedValue(new Error('boom')) };
    const processor = new WebhooksProcessor(handler as unknown as WebhookEventHandler);

    await expect(processor.process(job({ webhookEventId: 'evt-1' }))).rejects.toThrow('boom');
  });
});

describe('PayoutsProcessor', () => {
  it('hands the payout id to the payouts service', async () => {
    const payouts = { processPayout: jest.fn().mockResolvedValue(undefined) };
    const processor = new PayoutsProcessor(payouts as unknown as PayoutsService);

    await processor.process(job({ payoutId: 'payout-1' }));

    expect(payouts.processPayout).toHaveBeenCalledWith('payout-1');
  });
});

describe('ReconciliationProcessor', () => {
  function build() {
    const reconciliation = { run: jest.fn().mockResolvedValue({ trialBalanced: true }) };
    const payouts = { enqueueDuePayouts: jest.fn().mockResolvedValue(3) };
    const processor = new ReconciliationProcessor(
      reconciliation as unknown as ReconciliationService,
      payouts as unknown as PayoutsService,
    );
    return { processor, reconciliation, payouts };
  }

  it('runs reconciliation for the reconcile job and returns its report', async () => {
    const { processor, reconciliation } = build();

    await expect(processor.process(job({}, RECONCILE_JOB))).resolves.toEqual({
      trialBalanced: true,
    });
    expect(reconciliation.run).toHaveBeenCalledTimes(1);
  });

  it('runs the payout sweep and reports how many it enqueued', async () => {
    const { processor, payouts } = build();

    await expect(processor.process(job({}, PAYOUT_SWEEP_JOB))).resolves.toEqual({ enqueued: 3 });
    expect(payouts.enqueueDuePayouts).toHaveBeenCalledTimes(1);
  });

  it('ignores an unrecognised job name instead of failing the queue', async () => {
    const { processor, reconciliation, payouts } = build();

    await expect(processor.process(job({}, 'mystery'))).resolves.toBeUndefined();
    expect(reconciliation.run).not.toHaveBeenCalled();
    expect(payouts.enqueueDuePayouts).not.toHaveBeenCalled();
  });
});
