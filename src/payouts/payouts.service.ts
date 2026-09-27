import { Inject, Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LedgerAccountType, Payout, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PAYOUT_PROVIDER, PayoutProvider } from '../payments/interfaces';
import { PayoutJobData, payoutJobOptions } from '../payments/payment-settlement.service';
import { PAYOUTS_QUEUE } from '../queue/queue.module';
import { resolveBankCode } from './bank-codes';

/** Automatic re-attempts after the bank rejects/reverses a transfer. */
export const MAX_AUTOMATIC_TRANSFER_ATTEMPTS = 3;

/** Where a payout is going, once the account type has been resolved. */
type PayoutDestination =
  | {
      outcome: 'send';
      recipientName: string;
      bankCode: string;
      accountNumber: string;
      transferReason: string;
    }
  | { outcome: 'hold'; reason: string }
  | { outcome: 'review'; reason: string };

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
      if (previous.status === 'requires_action') {
        // Parked at the provider awaiting a human. It has NOT moved no money -
        // it may still pay out - so starting another transfer would settle the
        // same obligation twice.
        await this.flagForOperator(payout.id, payout.transferReference);
        return;
      }
      // failed | reversed | not_found: that attempt moved no money.
    }

    // Entertainer or venue: both are a payable account with a bank destination
    // behind it, and everything downstream of this point - claiming the attempt,
    // creating the recipient, transferring, retrying, never dropping the
    // liability - is identical. Only the lookup and the gate differ.
    const destination = await this.resolveDestination(payout);

    if (destination.outcome === 'review') {
      await this.markForReview(payout, destination.reason);
      return;
    }
    if (destination.outcome === 'hold') {
      // Not a failure: the obligation stands and the ledger is untouched, it
      // just is not payable yet. Back to QUEUED so the sweep re-checks it once
      // onboarding completes.
      if (payout.status !== 'QUEUED') {
        await this.prisma.payout.updateMany({
          where: { id: payout.id, status: payout.status },
          data: { status: 'QUEUED' },
        });
      }
      this.logger.log('Payout held: destination not ready', {
        payoutId,
        accountType: payout.ledgerAccount.type,
        reason: destination.reason,
      });
      return;
    }

    const { recipientName, bankCode, accountNumber, transferReason } = destination;

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
      name: recipientName,
      accountNumber,
      bankCode,
      currency: 'NGN',
      metadata: { ownerId: payout.ledgerAccount.ownerId, accountType: payout.ledgerAccount.type },
    });
    await this.prisma.payout.update({
      where: { id: payout.id },
      data: { recipientCode: recipient.recipientCode },
    });

    const transfer = await this.payoutProvider.initiateTransfer({
      amountKobo: payout.amountKobo,
      recipientCode: recipient.recipientCode,
      reference: transferReference,
      reason: transferReason,
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
    } else if (transfer.status === 'requires_action') {
      await this.flagForOperator(payout.id, transferReference);
    }
    // 'pending': the transfer.* webhook finishes it.
  }

  /**
   * Where this payout is going, and whether it may go there yet.
   *
   *  - 'send'   : a confirmed destination; proceed.
   *  - 'hold'   : onboarding is incomplete. The obligation stands, the ledger is
   *               untouched, and the sweep will re-check it. Not a failure.
   *  - 'review' : something a person has to fix (no such owner, no bank details,
   *               an unresolvable bank).
   *
   * Both account types require accountConfirmedAt for the same reason: until
   * somebody confirmed the name the BANK returned for the account, the
   * destination is a number that was typed in. Entertainers additionally require
   * KYC VERIFIED, because an entertainer is an unknown individual; a venue is a
   * business already vetted at onboarding, which is why there is no
   * identity-verification step on the venue side.
   */
  private async resolveDestination(payout: {
    id: string;
    ledgerAccount: { type: LedgerAccountType; ownerId: string | null };
  }): Promise<PayoutDestination> {
    const ownerId = payout.ledgerAccount.ownerId;
    if (!ownerId) {
      // PLATFORM_REVENUE and PROCESSOR_CLEARING have no owner and are never
      // paid out; a payout row against one is a bug, not a destination.
      return {
        outcome: 'review',
        reason: `Payable account has no owner (${payout.ledgerAccount.type})`,
      };
    }

    if (payout.ledgerAccount.type === 'ENTERTAINER_PAYABLE') {
      const entertainer = await this.prisma.entertainer.findUnique({ where: { id: ownerId } });
      if (!entertainer) {
        return { outcome: 'review', reason: 'Entertainer for payable account not found' };
      }
      if (entertainer.kycStatus !== 'VERIFIED' || !entertainer.accountConfirmedAt) {
        return {
          outcome: 'hold',
          reason: `KYC ${entertainer.kycStatus}, account confirmed: ${entertainer.accountConfirmedAt !== null}`,
        };
      }
      if (!entertainer.bankName || !entertainer.accountNumber) {
        return { outcome: 'review', reason: 'Missing bank account details' };
      }
      // Onboarding captures the provider's own bank code; the name lookup is
      // only a fallback for entertainers who predate that.
      const bankCode = entertainer.bankCode ?? resolveBankCode(entertainer.bankName);
      if (!bankCode) {
        return { outcome: 'review', reason: `Unknown bank: ${entertainer.bankName}` };
      }
      return {
        outcome: 'send',
        // The legal name, not the stage name: the bank is being told who owns
        // the account.
        recipientName: entertainer.legalName,
        bankCode,
        accountNumber: entertainer.accountNumber,
        transferReason: `Splitcore tip payout - ${entertainer.stageName}`,
      };
    }

    if (payout.ledgerAccount.type === 'VENUE_PAYABLE') {
      const venue = await this.prisma.venue.findUnique({ where: { id: ownerId } });
      if (!venue) {
        return { outcome: 'review', reason: 'Venue for payable account not found' };
      }
      if (!venue.accountConfirmedAt) {
        return { outcome: 'hold', reason: 'Venue payout account not confirmed' };
      }
      if (!venue.bankName || !venue.accountNumber) {
        return { outcome: 'review', reason: 'Missing venue bank account details' };
      }
      const bankCode = venue.bankCode ?? resolveBankCode(venue.bankName);
      if (!bankCode) {
        return { outcome: 'review', reason: `Unknown bank: ${venue.bankName}` };
      }
      return {
        outcome: 'send',
        // The name the bank returned, which is the account's real holder, rather
        // than the venue's trading name.
        recipientName: venue.resolvedAccountName ?? venue.name,
        bankCode,
        accountNumber: venue.accountNumber,
        transferReason: `Splitcore venue payout - ${venue.name}`,
      };
    }

    return {
      outcome: 'review',
      reason: `Unsupported payable account type: ${payout.ledgerAccount.type}`,
    };
  }

  /**
   * The provider accepted the transfer but will not move money without a human
   * (Paystack `otp`, or `blocked`). No webhook is coming, so the 15-minute
   * sweep would otherwise re-verify this forever and report nothing wrong.
   *
   * The payout stays PROCESSING on purpose: the transfer is genuinely live at
   * the provider, so re-sending it could pay the same obligation twice. The
   * ledger is untouched, so the liability is still on the books either way.
   */
  private async flagForOperator(payoutId: string, transferReference: string): Promise<void> {
    const reason =
      'Action required: the provider will not complete this transfer without a human. ' +
      'For Paystack this means "Disable OTP for Transfers" is still switched on for the ' +
      'account (Settings > Preferences); until it is off, no payout can complete ' +
      'automatically. The transfer is live at the provider, so do not re-send it.';

    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { failureReason: reason },
    });

    this.logger.error('Payout needs operator action; no webhook will complete it', {
      payoutId,
      transferReference,
      providerStatus: 'requires_action',
    });
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
        // Both payable types now, since a venue with a confirmed account is as
        // payable as a verified entertainer.
        ledgerAccount: { type: { in: ['ENTERTAINER_PAYABLE', 'VENUE_PAYABLE'] } },
        OR: [
          { status: { in: ['QUEUED', 'RETRYING'] } },
          { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
        ],
      },
      select: { id: true, ledgerAccount: { select: { ownerId: true, type: true } } },
      take: 500,
    });

    const ownerIdsFor = (type: LedgerAccountType) => [
      ...new Set(
        candidates
          .filter((p) => p.ledgerAccount.type === type && p.ledgerAccount.ownerId)
          .map((p) => p.ledgerAccount.ownerId!),
      ),
    ];

    // Each gate mirrors resolveDestination exactly. If they drifted, the sweep
    // would enqueue payouts that processPayout then immediately holds again -
    // busywork that looks like progress.
    const [payableEntertainers, payableVenues] = await Promise.all([
      this.prisma.entertainer.findMany({
        where: {
          id: { in: ownerIdsFor('ENTERTAINER_PAYABLE') },
          kycStatus: 'VERIFIED',
          accountConfirmedAt: { not: null },
        },
        select: { id: true },
      }),
      this.prisma.venue.findMany({
        // No KYC equivalent for a venue: a business vetted at onboarding needs
        // only a confirmed destination.
        where: { id: { in: ownerIdsFor('VENUE_PAYABLE') }, accountConfirmedAt: { not: null } },
        select: { id: true },
      }),
    ]);

    const payable = new Set([
      ...payableEntertainers.map((e) => e.id),
      ...payableVenues.map((v) => v.id),
    ]);

    const due = candidates.filter(
      (p) => p.ledgerAccount.ownerId && payable.has(p.ledgerAccount.ownerId),
    );
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
