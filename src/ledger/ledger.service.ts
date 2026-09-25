import { Injectable } from '@nestjs/common';
import { LedgerAccountType, LedgerDirection } from '@prisma/client';

export const BASIS_POINTS_TOTAL = 10000;

/**
 * One line of a double-entry posting, addressed by account type + owner
 * rather than account id, so computing it needs no database lookups.
 */
export interface LedgerEntrySpec {
  accountType: LedgerAccountType;
  ownerId: string | null;
  direction: LedgerDirection;
  amountKobo: number;
}

/** The fields of a payment that decide how it's divided. */
export interface PaymentForPosting {
  grossAmountKobo: number;
  venueId: string;
  entertainerId: string | null;
}

/** The fields of a split rule that decide how a payment is divided. */
export interface SplitForPosting {
  entertainerBps: number;
  venueBps: number;
  platformBps: number;
}

/** A payout obligation leaving (or returning to) a payable account. */
export interface PayoutForPosting {
  accountType: LedgerAccountType;
  ownerId: string | null;
  amountKobo: number;
}

export class UnbalancedLedgerError extends Error {
  constructor(
    readonly totalDebits: number,
    readonly totalCredits: number,
  ) {
    super(`Ledger entries do not balance: debits=${totalDebits}, credits=${totalCredits}`);
    this.name = 'UnbalancedLedgerError';
  }
}

export class InvalidPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPostingError';
  }
}

/**
 * Ledger Service: pure posting logic, no I/O, no injected dependencies.
 *
 * Given a payment and a split rule (or a payout), it returns the entries to
 * write. Persisting them is LedgerRepository's job, and the database
 * independently refuses unbalanced or mutated entries (see the
 * phase3_ledger_integrity migration), so correctness here is checked twice.
 *
 * Account semantics:
 * - PROCESSOR_CLEARING is an asset: money held at the processor.
 *   DEBIT = money in (a guest paid), CREDIT = money out (a transfer left).
 * - *_PAYABLE / PLATFORM_REVENUE are credit-normal: CREDIT = owed/earned.
 *
 * ₦5,000 at 85/10/5:
 *   DEBIT  PROCESSOR_CLEARING   500000
 *   CREDIT ENTERTAINER_PAYABLE  425000
 *   CREDIT VENUE_PAYABLE         50000
 *   CREDIT PLATFORM_REVENUE      25000
 *
 * A successful payout of that entertainer share then posts:
 *   DEBIT  ENTERTAINER_PAYABLE  425000
 *   CREDIT PROCESSOR_CLEARING   425000
 * and a failed payout posts nothing, so the payable balance is untouched.
 */
@Injectable()
export class LedgerService {
  /**
   * Entries for a settled guest payment.
   *
   * Rounding: entertainer and venue shares are floored; the platform takes
   * the remainder (at most 2 kobo), so the posting always balances exactly.
   * A payment with no entertainer (venue QR) gives the entertainer share to
   * the venue.
   */
  computePaymentEntries(payment: PaymentForPosting, split: SplitForPosting): LedgerEntrySpec[] {
    this.assertValidSplit(split);

    const gross = payment.grossAmountKobo;
    if (!Number.isSafeInteger(gross) || gross <= 0) {
      throw new InvalidPostingError(`Gross amount must be a positive integer kobo, got ${gross}`);
    }

    const entertainerShare = payment.entertainerId
      ? this.applyBasisPoints(gross, split.entertainerBps)
      : 0;
    const venueBps = payment.entertainerId ? split.venueBps : split.venueBps + split.entertainerBps;
    const venueShare = this.applyBasisPoints(gross, venueBps);
    const platformShare = gross - entertainerShare - venueShare;

    const entries: LedgerEntrySpec[] = [
      { accountType: 'PROCESSOR_CLEARING', ownerId: null, direction: 'DEBIT', amountKobo: gross },
    ];

    // Zero-value lines (e.g. a 0 bps platform share) are omitted rather than
    // written; the database only accepts positive amounts.
    if (entertainerShare > 0) {
      entries.push({
        accountType: 'ENTERTAINER_PAYABLE',
        ownerId: payment.entertainerId,
        direction: 'CREDIT',
        amountKobo: entertainerShare,
      });
    }
    if (venueShare > 0) {
      entries.push({
        accountType: 'VENUE_PAYABLE',
        ownerId: payment.venueId,
        direction: 'CREDIT',
        amountKobo: venueShare,
      });
    }
    if (platformShare > 0) {
      entries.push({
        accountType: 'PLATFORM_REVENUE',
        ownerId: null,
        direction: 'CREDIT',
        amountKobo: platformShare,
      });
    }

    this.assertBalanced(entries);
    return entries;
  }

  /** Entries for a payout that the processor has confirmed as delivered. */
  computePayoutEntries(payout: PayoutForPosting): LedgerEntrySpec[] {
    this.assertPayable(payout);
    const entries: LedgerEntrySpec[] = [
      {
        accountType: payout.accountType,
        ownerId: payout.ownerId,
        direction: 'DEBIT',
        amountKobo: payout.amountKobo,
      },
      {
        accountType: 'PROCESSOR_CLEARING',
        ownerId: null,
        direction: 'CREDIT',
        amountKobo: payout.amountKobo,
      },
    ];
    this.assertBalanced(entries);
    return entries;
  }

  /**
   * Compensating entries for a payout that was confirmed and later reversed
   * by the bank. The obligation goes back onto the payable account.
   */
  computePayoutReversalEntries(payout: PayoutForPosting): LedgerEntrySpec[] {
    return this.computePayoutEntries(payout).map((entry) => ({
      ...entry,
      direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    }));
  }

  /**
   * Balance of an account from its entries, in the account's normal sense:
   * PROCESSOR_CLEARING is debit-normal, everything else credit-normal.
   */
  balanceOf(
    accountType: LedgerAccountType,
    entries: ReadonlyArray<{ direction: LedgerDirection; amountKobo: number }>,
  ): number {
    const sign = accountType === 'PROCESSOR_CLEARING' ? 1 : -1;
    return entries.reduce(
      (sum, e) => sum + (e.direction === 'DEBIT' ? sign : -sign) * e.amountKobo,
      0,
    );
  }

  assertBalanced(entries: ReadonlyArray<LedgerEntrySpec>): void {
    let totalDebits = 0;
    let totalCredits = 0;
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.amountKobo) || entry.amountKobo <= 0) {
        throw new InvalidPostingError(
          `Entry amounts must be positive integer kobo, got ${entry.amountKobo}`,
        );
      }
      if (entry.direction === 'DEBIT') totalDebits += entry.amountKobo;
      else totalCredits += entry.amountKobo;
    }
    if (entries.length === 0 || totalDebits !== totalCredits) {
      throw new UnbalancedLedgerError(totalDebits, totalCredits);
    }
  }

  /** floor(amount × bps / 10000), integer arithmetic only. */
  applyBasisPoints(amountKobo: number, basisPoints: number): number {
    return Math.floor((amountKobo * basisPoints) / BASIS_POINTS_TOTAL);
  }

  private assertValidSplit(split: SplitForPosting): void {
    const parts = [split.entertainerBps, split.venueBps, split.platformBps];
    if (parts.some((bps) => !Number.isInteger(bps) || bps < 0)) {
      throw new InvalidPostingError('Split basis points must be non-negative integers');
    }
    const total = parts.reduce((a, b) => a + b, 0);
    if (total !== BASIS_POINTS_TOTAL) {
      throw new InvalidPostingError(`Split basis points sum to ${total}, expected 10000`);
    }
  }

  private assertPayable(payout: PayoutForPosting): void {
    if (payout.accountType !== 'ENTERTAINER_PAYABLE' && payout.accountType !== 'VENUE_PAYABLE') {
      throw new InvalidPostingError(`Cannot pay out from a ${payout.accountType} account`);
    }
    if (!payout.ownerId) {
      throw new InvalidPostingError('Payable account must have an owner');
    }
  }
}
