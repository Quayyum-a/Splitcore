import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PAYOUTS_QUEUE, RECONCILIATION_QUEUE, WEBHOOKS_QUEUE } from './queue.module';
import { WebhookEventHandler } from '../webhooks/webhook-event-handler.service';
import { WebhookJobData } from '../webhooks/webhooks.service';
import { PayoutsService } from '../payouts/payouts.service';
import { PayoutJobData } from '../payments/payment-settlement.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

/*
 * Thin BullMQ adapters, same shape as DiagnosticsProcessor. The logic lives
 * in services so it can be exercised directly in tests without a worker.
 */

@Processor(WEBHOOKS_QUEUE, { concurrency: 5 })
export class WebhooksProcessor extends WorkerHost {
  constructor(private readonly handler: WebhookEventHandler) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    await this.handler.handle(job.data.webhookEventId);
  }
}

@Processor(PAYOUTS_QUEUE, { concurrency: 5 })
export class PayoutsProcessor extends WorkerHost {
  constructor(private readonly payouts: PayoutsService) {
    super();
  }

  async process(job: Job<PayoutJobData>): Promise<void> {
    await this.payouts.processPayout(job.data.payoutId);
  }
}

export const RECONCILE_JOB = 'reconcile';
export const PAYOUT_SWEEP_JOB = 'payout-sweep';

@Processor(RECONCILIATION_QUEUE)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly payouts: PayoutsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case RECONCILE_JOB:
        return this.reconciliation.run();
      case PAYOUT_SWEEP_JOB:
        return { enqueued: await this.payouts.enqueueDuePayouts() };
      default:
        this.logger.warn(`Unknown job ${job.name} on ${RECONCILIATION_QUEUE}`);
        return undefined;
    }
  }
}
