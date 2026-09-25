import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentSettlementService,
  SettlementIntegrityError,
} from '../payments/payment-settlement.service';
import { PayoutsService } from '../payouts/payouts.service';
import type { PaystackWebhookPayload } from './webhooks.service';

/**
 * Processes a stored webhook event (runs in the worker).
 *
 * Deliberately doesn't trust the payload beyond using it to find the
 * reference: charge.success goes through settlement, which re-verifies
 * with the provider before anything is written.
 */
@Injectable()
export class WebhookEventHandler {
  private readonly logger = new Logger(WebhookEventHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: PaymentSettlementService,
    private readonly payouts: PayoutsService,
  ) {}

  async handle(webhookEventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      this.logger.warn('Webhook event not found', { webhookEventId });
      return;
    }
    if (event.processingStatus === 'COMPLETED') {
      return;
    }

    await this.setStatus(event.id, 'PROCESSING');

    const payload = event.payload as PaystackWebhookPayload;
    const reference = typeof payload?.data?.reference === 'string' ? payload.data.reference : null;

    try {
      if (!reference) {
        this.logger.warn('Webhook without a reference; nothing to do', {
          webhookEventId,
          eventType: event.eventType,
        });
      } else {
        switch (event.eventType) {
          case 'charge.success':
            await this.settlement.settle(reference);
            break;
          case 'transfer.success':
            await this.payouts.handleTransferEvent(reference, 'success');
            break;
          case 'transfer.failed':
            await this.payouts.handleTransferEvent(reference, 'failed');
            break;
          case 'transfer.reversed':
            await this.payouts.handleTransferEvent(reference, 'reversed');
            break;
          default:
            this.logger.log('Unhandled webhook event type', { eventType: event.eventType });
        }
      }
    } catch (error) {
      if (error instanceof SettlementIntegrityError) {
        // Retrying can't fix an amount/currency mismatch; park it for a human.
        this.logger.error('Settlement integrity failure; needs manual review', {
          webhookEventId,
          reference: error.reference,
          error: error.message,
        });
        await this.setStatus(event.id, 'FAILED');
        return;
      }
      await this.setStatus(event.id, 'FAILED');
      throw error; // BullMQ retries
    }

    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'COMPLETED', processedAt: new Date() },
    });
  }

  private async setStatus(id: string, processingStatus: string): Promise<void> {
    await this.prisma.webhookEvent.update({ where: { id }, data: { processingStatus } });
  }
}
