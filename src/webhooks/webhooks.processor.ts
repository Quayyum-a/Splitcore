import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import { PayoutsService } from '../payouts/payouts.service';

/**
 * Job payload for webhook processing
 */
interface WebhookJobPayload {
  webhookEventId: string;
  provider: string;
  eventType: string;
  externalEventId: string;
}

/**
 * Webhooks Processor
 *
 * Processes webhook events asynchronously via BullMQ.
 * Handles payment success → ledger entries → payout trigger.
 *
 * This is where the actual financial processing happens!
 */
@Processor('webhooks', {
  concurrency: 5, // Process up to 5 webhooks concurrently
})
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly paystackProvider: PaystackProvider,
    private readonly payoutsService: PayoutsService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobPayload>): Promise<void> {
    const { webhookEventId, provider, eventType, externalEventId } = job.data;

    this.logger.log('Processing webhook event', {
      jobId: job.id,
      webhookEventId,
      provider,
      eventType,
      externalEventId,
    });

    try {
      // Mark as processing
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processingStatus: 'PROCESSING' },
      });

      // Route to appropriate handler
      if (provider === 'paystack') {
        await this.processPaystackEvent(webhookEventId, eventType);
      } else {
        this.logger.warn('Unknown provider', { provider });
      }

      // Mark as completed
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          processingStatus: 'COMPLETED',
          processedAt: new Date(),
        },
      });

      this.logger.log('Webhook event processed successfully', {
        webhookEventId,
        eventType,
      });
    } catch (error) {
      this.logger.error('Failed to process webhook event', {
        webhookEventId,
        eventType,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Mark as failed
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processingStatus: 'FAILED' },
      });

      throw error; // Re-throw for BullMQ retry logic
    }
  }

  /**
   * Process Paystack webhook events
   */
  private async processPaystackEvent(webhookEventId: string, eventType: string): Promise<void> {
    const webhookEvent = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!webhookEvent) {
      throw new Error(`Webhook event ${webhookEventId} not found`);
    }

    const payload = webhookEvent.payload as any;

    switch (eventType) {
      case 'charge.success':
        await this.handleChargeSuccess(payload);
        break;

      case 'transfer.success':
        await this.handleTransferSuccess(payload);
        break;

      case 'transfer.failed':
      case 'transfer.reversed':
        await this.handleTransferFailure(payload);
        break;

      default:
        this.logger.log('Unhandled event type', { eventType });
        // Not an error - just log and move on
        break;
    }
  }

  /**
   * Handle successful payment (charge.success)
   *
   * This is where money enters the system!
   * 1. Verify payment with Paystack API (double-check)
   * 2. Update payment transaction status
   * 3. Create ledger entries (double-entry bookkeeping)
   * 4. TODO: Trigger payout (Task 5)
   */
  private async handleChargeSuccess(payload: any): Promise<void> {
    const reference = payload?.data?.reference;

    if (!reference) {
      this.logger.error('No reference in charge.success payload', { payload });
      return;
    }

    this.logger.log('Processing charge.success', { reference });

    // Find payment transaction
    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalReference: reference },
      include: {
        venue: true,
        entertainer: true,
      },
    });

    if (!paymentTransaction) {
      this.logger.error('Payment transaction not found for reference', { reference });
      return;
    }

    // If already SUCCESS, this is a duplicate webhook (idempotency at transaction level)
    if (paymentTransaction.status === 'SUCCESS') {
      this.logger.log('Payment already marked as SUCCESS (idempotency)', {
        transactionId: paymentTransaction.id,
        reference,
      });
      return;
    }

    // Verify with Paystack API (double-check)
    const verification = await this.paystackProvider.verifyPayment(reference);

    if (verification.status !== 'success') {
      this.logger.error('Payment verification failed', {
        reference,
        verificationStatus: verification.status,
      });
      // Update to failed status
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    // Verify amount matches
    if (verification.amountKobo !== paymentTransaction.grossAmountKobo) {
      this.logger.error('Payment amount mismatch', {
        reference,
        expected: paymentTransaction.grossAmountKobo,
        actual: verification.amountKobo,
      });
      // This is suspicious - mark as failed and alert
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    // Get active split rule
    const splitRule = await this.prisma.splitRule.findFirst({
      where: {
        venueId: paymentTransaction.venueId,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!splitRule) {
      this.logger.error('No active split rule found', {
        venueId: paymentTransaction.venueId,
        transactionId: paymentTransaction.id,
      });
      // This should never happen (blocked at payment init), but handle gracefully
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    // Compute ledger entries
    const ledgerEntries = this.ledgerService.computeLedgerEntries(paymentTransaction, splitRule);

    // Write ledger entries and update payment status in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Write ledger entries
      await this.ledgerService.writeLedgerEntries(paymentTransaction.id, ledgerEntries);

      // Update payment status to SUCCESS
      await tx.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: { status: 'SUCCESS' },
      });
    });

    this.logger.log('Payment processed successfully', {
      transactionId: paymentTransaction.id,
      reference,
      amountKobo: paymentTransaction.grossAmountKobo,
      ledgerEntriesCount: ledgerEntries.length,
    });

    // Trigger payouts for this transaction
    await this.payoutsService.createPayoutsForTransaction(paymentTransaction.id);
  }

  /**
   * Handle successful transfer (transfer.success)
   * Triggered when a payout reaches the recipient's bank account
   */
  private async handleTransferSuccess(payload: any): Promise<void> {
    const reference = payload?.data?.reference;

    if (!reference) {
      this.logger.error('No reference in transfer.success payload', { payload });
      return;
    }

    this.logger.log('Processing transfer.success', { reference });

    await this.payoutsService.updatePayoutFromWebhook(reference, 'success');
  }

  /**
   * Handle failed/reversed transfer
   * Triggered when a payout fails or is reversed
   */
  private async handleTransferFailure(payload: any): Promise<void> {
    const reference = payload?.data?.reference;
    const reason = payload?.data?.failure_reason;

    if (!reference) {
      this.logger.error('No reference in transfer failure payload', { payload });
      return;
    }

    this.logger.log('Processing transfer failure', { reference, reason });

    await this.payoutsService.updatePayoutFromWebhook(reference, 'failed', reason);
  }
}
