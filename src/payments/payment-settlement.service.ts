import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PaymentStatus, PaymentTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PAYMENT_PROVIDER, PaymentProvider } from './interfaces';
import { PAYOUTS_QUEUE } from '../queue/queue.module';
import { withTimeout } from '../common/utils/with-timeout';

export const SETTLEMENT_CURRENCY = 'NGN';

const ENQUEUE_TIMEOUT_MS = 2000;

/** Statuses from which a provider-confirmed charge may still be settled. */
const SETTLEABLE: PaymentStatus[] = ['CREATED', 'PENDING', 'FAILED', 'ABANDONED'];

/**
 * The provider says the charge succeeded, but something about it doesn't
 * match what we initialized (amount, currency, missing split snapshot).
 * Money may have been taken, so this is never silently turned into FAILED:
 * the payment keeps its status and the error surfaces for manual review.
 */
export class SettlementIntegrityError extends Error {
  constructor(
    message: string,
    readonly reference: string,
  ) {
    super(message);
    this.name = 'SettlementIntegrityError';
  }
}

export interface PayoutJobData {
  payoutId: string;
}

export function payoutJobOptions(payoutId: string) {
  return {
    // jobId dedupes: enqueuing a payout that is already waiting or running
    // is a no-op. Finished jobs are removed so the same payout can be
    // enqueued again later (retry, KYC release); the payout row itself is
    // the durable record of what happened.
    jobId: `payout:${payoutId}`,
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/**
 * Payment Settlement: the ONLY code path that moves a payment to SUCCESS.
 *
 * Both the webhook worker and the guest-facing status poll call settle().
 * It always re-verifies with the provider (never trusts a redirect or a
 * webhook body), and in ONE database transaction:
 *   1. claims the payment (conditional status update: exactly one caller wins)
 *   2. writes the balanced ledger posting
 *   3. creates the payout obligations
 * Whoever loses the claim does nothing, so concurrent or duplicate
 * settlement attempts can never double-post.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly ledgerRepository: LedgerRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @InjectQueue(PAYOUTS_QUEUE) private readonly payoutsQueue: Queue<PayoutJobData>,
  ) {}

  async settle(reference: string): Promise<PaymentTransaction | null> {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { externalReference: reference },
    });

    if (!payment) {
      this.logger.warn('Settlement requested for unknown reference', { reference });
      return null;
    }

    if (!SETTLEABLE.includes(payment.status)) {
      return payment;
    }

    const verification = await this.paymentProvider.verifyPayment(reference);

    if (verification.status === 'failed') {
      await this.transition(payment.id, ['CREATED', 'PENDING'], 'FAILED');
      return this.reload(payment.id);
    }

    if (verification.status !== 'success') {
      // 'abandoned' from Paystack also covers "checkout opened, not paid
      // yet", so a guest still on the checkout page must not be marked
      // abandoned. Anything not yet successful is simply PENDING.
      await this.transition(payment.id, ['CREATED'], 'PENDING');
      return this.reload(payment.id);
    }

    if (verification.amountKobo !== payment.grossAmountKobo) {
      throw new SettlementIntegrityError(
        `Amount mismatch: initialized ${payment.grossAmountKobo} kobo, provider reports ${verification.amountKobo} kobo`,
        reference,
      );
    }
    if (verification.currency && verification.currency !== SETTLEMENT_CURRENCY) {
      throw new SettlementIntegrityError(
        `Currency mismatch: expected ${SETTLEMENT_CURRENCY}, provider reports ${verification.currency}`,
        reference,
      );
    }
    if (!payment.splitRuleId) {
      throw new SettlementIntegrityError(
        'Payment has no split rule snapshot; refusing to invent a split',
        reference,
      );
    }

    const splitRule = await this.prisma.splitRule.findUniqueOrThrow({
      where: { id: payment.splitRuleId },
    });
    const entries = this.ledger.computePaymentEntries(payment, splitRule);

    const payoutIds = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.paymentTransaction.updateMany({
        where: { id: payment.id, status: { in: SETTLEABLE } },
        data: { status: 'SUCCESS' },
      });
      if (claim.count === 0) {
        return null; // settled concurrently by the webhook or a poll
      }

      await this.ledgerRepository.post(tx, payment.id, entries);

      const ids: string[] = [];
      for (const entry of entries) {
        const isPayable =
          entry.direction === 'CREDIT' &&
          (entry.accountType === 'ENTERTAINER_PAYABLE' || entry.accountType === 'VENUE_PAYABLE');
        if (!isPayable) continue;

        const ledgerAccountId = await this.ledgerRepository.resolveAccountId(
          tx,
          entry.accountType,
          entry.ownerId,
        );
        const payout = await tx.payout.create({
          data: { ledgerAccountId, transactionId: payment.id, amountKobo: entry.amountKobo },
        });
        ids.push(payout.id);
      }
      return ids;
    });

    if (payoutIds === null) {
      this.logger.log('Payment already settled by a concurrent caller', { reference });
      return this.reload(payment.id);
    }

    this.logger.log('Payment settled', {
      transactionId: payment.id,
      reference,
      grossAmountKobo: payment.grossAmountKobo,
      entries: entries.length,
      payouts: payoutIds.length,
    });

    await this.enqueuePayouts(payoutIds);
    return this.reload(payment.id);
  }

  /**
   * Best effort: if Redis is unavailable the payout rows are already
   * committed as QUEUED, and the periodic payout sweep picks them up.
   */
  private async enqueuePayouts(payoutIds: string[]): Promise<void> {
    for (const payoutId of payoutIds) {
      try {
        await withTimeout(
          this.payoutsQueue.add('process-payout', { payoutId }, payoutJobOptions(payoutId)),
          ENQUEUE_TIMEOUT_MS,
        );
      } catch (error) {
        this.logger.warn('Could not enqueue payout; sweep will retry', {
          payoutId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async transition(id: string, from: PaymentStatus[], to: PaymentStatus): Promise<void> {
    await this.prisma.paymentTransaction.updateMany({
      where: { id, status: { in: from } },
      data: { status: to },
    });
  }

  private reload(id: string): Promise<PaymentTransaction> {
    return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
  }
}
