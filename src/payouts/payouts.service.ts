import { Inject, Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Payout, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PAYOUT_PROVIDER, PayoutProvider } from '../payments/interfaces';
import { PayoutJobData, payoutJobOptions } from '../payments/payment-settlement.service';
import { PAYOUTS_QUEUE } from '../queue/queue.module';
import { resolveBankCode } from './bank-codes';

/** Automatic re-attempts after the bank rejects/reverses a transfer. */
export const MAX_AUTOMATIC_TRANSFER_ATTEMPTS = 3;

/** A PROCESSING payout untouched this long gets re-verified by the sweep. */
const STALE_PROCESSING_MS = 15 * 60 * 1000;

const OPEN_STATUSES: PayoutStatus[] = ['QUEUED', 'RETRYING', 'PROCESSING'];

/**
 * Payouts: moving what the ledger says is owed out to the owner's bank.
 *
 * Guarantees:
 * - Idempotent. The transfer reference is persisted BEFORE the provider is
 *   called, and any existing reference is verified with the provider before
 *   a new attempt starts, so a crash, timeout or retried job can't transfer
 *   the same obligation twice.
 * - The ledger is debited only when the provider confirms delivery. A
 *   failed payout posts nothing, so the payable balance stays exactly as it
 *   was: the liability is never dropped because a transfer bounced.
 * - KYC-gated. Entertainers who aren't VERIFIED keep QUEUED payouts (their
 *   balance still accrues) until the sweep finds them verified.
 * - Per-tip, immediate transfers. Most tips are under ₦10,000, so most
 *   transfers avoid the ₦50 stamp duty; batching would lose that.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly ledgerRepository: LedgerRepository,
    @Inject(PAYOUT_PROVIDER) private readonly payoutProvider: PayoutProvider,
    @InjectQueue(PAYOUTS_QUEUE) private readonly payoutsQueue: Queue<PayoutJobData>,
  ) {}

  /** Worker entry point; safe to call any number of times for one payout. */
  async processPayout(payoutId: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { ledgerAccount: true },
    });

    if (!payout) {
      this.logger.warn('Payout not found', { payoutId });
      return;
    }
    if (!OPEN_STATUSES.includes(payout.status)) {
      return; // SUCCESS/CANCELLED are final; FAILED waits for manual retry
    }

    // An earlier attempt may have reached the provider. Never start a new
    // transfer until we know that one didn't (and won't) pay out.
    if (payout.transferReference) {
      const previous = await this.payoutProvider.verifyTransfer(payout.transferReference);
      if (previous.status === 'success') {
        await this.markSucceeded(payout.id, payout.transferReference);
        return;
      }
      if (previous.status === 'pending') {
        return; // transfer.* webhook or the sweep resolves it
      }
      // failed | reversed | not_found: that attempt moved no money.
    }

    if (payout.ledgerAccount.type !== 'ENTERTAINER_PAYABLE') {
      // Venues have no payout destination modelled yet; the obligation stays
      // QUEUED and the venue's payable balance keeps accruing.
      this.logger.log('Venue payouts not enabled; payout stays queued', { payoutId });
      return;
    }

    const entertainer = await this.prisma.entertainer.findUnique({
      where: { id: payout.ledgerAccount.ownerId! },
    });
    if (!entertainer) {
      await this.markForReview(payout, 'Entertainer for payable account not found');
      return;
    }

    if (entertainer.kycStatus !== 'VERIFIED') {
      if (payout.status !== 'QUEUED') {
        await this.prisma.payout.updateMany({
          where: { id: payout.id, status: payout.status },
          data: { status: 'QUEUED' },
        });
      }
      this.logger.log('Payout held: entertainer not KYC verified', {
        payoutId,
        entertainerId: entertainer.id,
        kycStatus: entertainer.kycStatus,
      });
      return;
    }

    if (!entertainer.bankName || !entertainer.accountNumber) {
      await this.markForReview(payout, 'Missing bank account details');
      return;
    }
    const bankCode = resolveBankCode(entertainer.bankName);
    if (!bankCode) {
      await this.markForReview(payout, `Unknown bank: ${entertainer.bankName}`);
      return;
    }

    // Claim the attempt and persist its reference before touching the
    // provider. The attempts guard means a concurrent worker loses the race.
    const attempt = payout.attempts + 1;
    const transferReference = `po_${payout.id.replace(/-/g, '')}_${attempt}`;
    const claim = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: { in: OPEN_STATUSES }, attempts: payout.attempts },
      data: {
        status: 'PROCESSING',
        attempts: attempt,
        transferReference,
        attemptedAt: new Date(),
        failureReason: null,
      },
    });
    if (claim.count === 0) {
      return;
    }

    // From here, any thrown error leaves the payout PROCESSING with this
    // reference; the retry verifies it first (see above).
    const recipient = await this.payoutProvider.createRecipient({
      type: 'nuban',
      name: entertainer.legalName,
      accountNumber: entertainer.accountNumber,
      bankCode,
      currency: 'NGN',
      metadata: { entertainerId: entertainer.id },
    });
    await this.prisma.payout.update({
      where: { id: payout.id },
      data: { recipientCode: recipient.recipientCode },
    });

    const transfer = await this.payoutProvider.initiateTransfer({
      amountKobo: payout.amountKobo,
      recipientCode: recipient.recipientCode,
      reference: transferReference,
      reason: `Splitcore tip payout - ${entertainer.stageName}`,
      currency: 'NGN',
      metadata: { payoutId: payout.id, transactionId: payout.transactionId },
    });

    this.logger.log('Transfer initiated', {
      payoutId,
      transferReference,
      attempt,
      amountKobo: payout.amountKobo,
      transferStatus: transfer.status,
    });

    if (transfer.status === 'success') {
      await this.markSucceeded(payout.id, transferReference);
    } else if (transfer.status === 'failed' || transfer.status === 'reversed') {
      await this.handleTransferEvent(transferReference, 'failed', transfer.failureReason);
    }
    // 'pending': the transfer.* webhook finishes it.
  }

  /** transfer.success / transfer.failed / transfer.reversed from the provider. */
  async handleTransferEvent(
    transferReference: string,
    outcome: 'success' | 'failed' | 'reversed',
    reason?: string,
  ): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { transferReference },
      include: { ledgerAccount: true },
    });
    if (!payout) {
      this.logger.warn('No payout for transfer reference', { transferReference });
      return;
    }

    if (outcome === 'success') {
      await this.markSucceeded(payout.id, transferReference);
      return;
    }

    if (outcome === 'reversed' && payout.status === 'SUCCESS') {
      // Money came back after we'd recorded it as paid: put the obligation
      // back on the payable account with compensating entries.
      const entries = this.ledger.computePayoutReversalEntries({
        accountType: payout.ledgerAccount.type,
        ownerId: payout.ledgerAccount.ownerId,
        amountKobo: payout.amountKobo,
      });
      const reversed = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.payout.updateMany({
          where: { id: payout.id, status: 'SUCCESS', transferReference },
          data: { status: 'RETRYING', completedAt: null, failureReason: reason ?? 'Reversed' },
        });
        if (claim.count === 0) return false;
        await this.ledgerRepository.post(tx, payout.transactionId, entries);
        return true;
      });
      if (!reversed) return;
      this.logger.warn('Payout reversed after success; balance restored', {
        payoutId: payout.id,
        transferReference,
      });
    } else if (payout.status !== 'SUCCESS') {
      // Nothing was posted for this attempt, so the payable balance is
      // already intact. Only the payout's state changes.
      await this.prisma.payout.updateMany({
        where: { id: payout.id, transferReference, status: { not: 'SUCCESS' } },
        data: { status: 'RETRYING', failureReason: reason ?? `Transfer ${outcome}` },
      });
    } else {
      return; // a late 'failed' for an attempt already confirmed successful
    }

    if (payout.attempts >= MAX_AUTOMATIC_TRANSFER_ATTEMPTS) {
      await this.markForReview(
        payout,
        `Transfer ${outcome} after ${payout.attempts} attempts: ${reason ?? 'no reason given'}`,
      );
      return;
    }
    await this.enqueue(payout.id, 60_000);
  }

  /**
   * Manual-review exit: re-open a FAILED payout (e.g. after bank details
   * were corrected). The balance was never removed, so there's nothing to
   * restore; the payout just gets another attempt.
   */
  async retryPayout(payoutId: string): Promise<Payout> {
    const claim = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'FAILED' },
      data: { status: 'RETRYING', failureReason: null },
    });
    if (claim.count === 0) {
      const exists = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!exists) throw new NotFoundException('Payout not found');
      throw new ConflictException(`Payout is ${exists.status}; only FAILED payouts can be retried`);
    }
    await this.enqueue(payoutId);
    return this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  }

  /**
   * Periodic sweep (worker, via BullMQ repeatable job). Enqueues:
   * - QUEUED/RETRYING entertainer payouts whose owner is now KYC VERIFIED
   *   (this is how a payout held for KYC is released)
   * - payouts whose enqueue failed at settlement time (Redis was down)
   * - PROCESSING payouts that have gone quiet, to re-verify with the provider
   */
  async enqueueDuePayouts(): Promise<number> {
    const candidates = await this.prisma.payout.findMany({
      where: {
        ledgerAccount: { type: 'ENTERTAINER_PAYABLE' },
        OR: [
          { status: { in: ['QUEUED', 'RETRYING'] } },
          { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
        ],
      },
      select: { id: true, ledgerAccount: { select: { ownerId: true } } },
      take: 500,
    });

    const ownerIds = [...new Set(candidates.map((p) => p.ledgerAccount.ownerId!))];
    const verified = new Set(
      (
        await this.prisma.entertainer.findMany({
          where: { id: { in: ownerIds }, kycStatus: 'VERIFIED' },
          select: { id: true },
        })
      ).map((e) => e.id),
    );

    const due = candidates.filter((p) => verified.has(p.ledgerAccount.ownerId!));
    for (const payout of due) {
      await this.enqueue(payout.id);
    }
    if (due.length > 0) {
      this.logger.log('Payout sweep enqueued payouts', { count: due.length });
    }
    return due.length;
  }

  /**
   * Record confirmed delivery: SUCCESS + ledger debit of the payable
   * account, atomically. The conditional update makes this exactly-once
   * even if the webhook and a verify race each other.
   */
  private async markSucceeded(payoutId: string, transferReference: string): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { ledgerAccount: true },
    });
    const entries = this.ledger.computePayoutEntries({
      accountType: payout.ledgerAccount.type,
      ownerId: payout.ledgerAccount.ownerId,
      amountKobo: payout.amountKobo,
    });

    const posted = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.payout.updateMany({
        where: { id: payoutId, transferReference, status: { not: 'SUCCESS' } },
        data: { status: 'SUCCESS', completedAt: new Date(), failureReason: null },
      });
      if (claim.count === 0) return false;
      await this.ledgerRepository.post(tx, payout.transactionId, entries);
      return true;
    });

    if (posted) {
      this.logger.log('Payout succeeded', {
        payoutId,
        transferReference,
        amountKobo: payout.amountKobo,
      });
    }
  }

  /** Terminal until a human calls retryPayout. The balance stays owed. */
  private async markForReview(payout: Payout, reason: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payout.id, status: { not: 'SUCCESS' } },
      data: { status: 'FAILED', failureReason: `MANUAL_REVIEW: ${reason}` },
    });
    this.logger.error('Payout needs manual review; payable balance retained', {
      payoutId: payout.id,
      reason,
    });
  }

  private async enqueue(payoutId: string, delay = 0): Promise<void> {
    await this.payoutsQueue.add(
      'process-payout',
      { payoutId },
      { ...payoutJobOptions(payoutId), delay },
    );
  }
}
