import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerAccountType, LedgerDirection, PaymentTransaction, SplitRule } from '@prisma/client';

/**
 * Ledger Entry specification for double-entry bookkeeping
 */
export interface LedgerEntrySpec {
  accountType: LedgerAccountType;
  ownerId: string | null;
  direction: LedgerDirection;
  amountKobo: number;
}

/**
 * Ledger Service
 *
 * CRITICAL: This is pure logic - given a transaction and split rule,
 * compute the ledger entries. No I/O inside computation logic.
 *
 * Rules (non-negotiable):
 * 1. Every transaction produces BALANCED entries (sum debits = sum credits)
 * 2. Entries are IMMUTABLE - corrections use compensating entries
 * 3. Split percentages from SplitRule.findActiveForVenue - NEVER hardcoded
 * 4. All amounts are INTEGER KOBO - NO FLOATS
 * 5. Reconciliation check enforced at write time, not just assumed
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute ledger entries for a successful payment
   *
   * This is PURE LOGIC - no database I/O.
   * Given payment + split rule, returns entries to write.
   *
   * Double-entry flow for ₦5,000 tip at 85/10/5 split:
   *
   * DEBIT  Processor Clearing    ₦5,000  (money enters system)
   * CREDIT Entertainer Payable   ₦4,250  (85%)
   * CREDIT Venue Payable         ₦500    (10%)
   * CREDIT Platform Revenue      ₦250    (5%)
   *
   * Sum debits = ₦5,000
   * Sum credits = ₦5,000
   * BALANCED ✓
   *
   * ROUNDING: Integer division may leave remainder.
   * Any rounding difference goes to Platform Revenue (house takes rounding loss/gain).
   */
  computeLedgerEntries(payment: PaymentTransaction, splitRule: SplitRule): LedgerEntrySpec[] {
    const entries: LedgerEntrySpec[] = [];
    const grossAmount = payment.grossAmountKobo;

    // Validate split rule adds to 10000 basis points (should be caught at split rule creation, but double-check)
    const totalBps = splitRule.entertainerBps + splitRule.venueBps + splitRule.platformBps;
    if (totalBps !== 10000) {
      this.logger.error('Invalid split rule: basis points do not sum to 10000', {
        splitRuleId: splitRule.id,
        entertainerBps: splitRule.entertainerBps,
        venueBps: splitRule.venueBps,
        platformBps: splitRule.platformBps,
        totalBps,
      });
      throw new BadRequestException('Invalid split rule configuration');
    }

    // DEBIT: Money enters system via processor
    entries.push({
      accountType: 'PROCESSOR_CLEARING',
      ownerId: null,
      direction: 'DEBIT',
      amountKobo: grossAmount,
    });

    let allocatedAmount = 0;

    // CREDIT: Entertainer's share (if entertainer exists)
    if (payment.entertainerId) {
      const entertainerAmount = this.applyBasisPoints(grossAmount, splitRule.entertainerBps);
      entries.push({
        accountType: 'ENTERTAINER_PAYABLE',
        ownerId: payment.entertainerId,
        direction: 'CREDIT',
        amountKobo: entertainerAmount,
      });
      allocatedAmount += entertainerAmount;
    }

    // CREDIT: Venue's share
    // If no entertainer, venue gets entertainer's share too (venue-only tips)
    const venueBps = payment.entertainerId
      ? splitRule.venueBps
      : splitRule.venueBps + splitRule.entertainerBps;
    const venueAmount = this.applyBasisPoints(grossAmount, venueBps);
    entries.push({
      accountType: 'VENUE_PAYABLE',
      ownerId: payment.venueId,
      direction: 'CREDIT',
      amountKobo: venueAmount,
    });
    allocatedAmount += venueAmount;

    // CREDIT: Platform's share + any rounding remainder
    // Platform absorbs rounding differences to ensure perfect balance
    const platformAmount = grossAmount - allocatedAmount;
    entries.push({
      accountType: 'PLATFORM_REVENUE',
      ownerId: null,
      direction: 'CREDIT',
      amountKobo: platformAmount,
    });

    return entries;
  }

  /**
   * Write ledger entries for a payment transaction
   *
   * CRITICAL: This enforces balance at write time in a DB transaction.
   * If entries don't balance, the entire write is rejected.
   */
  async writeLedgerEntries(
    paymentTransactionId: string,
    entries: LedgerEntrySpec[],
  ): Promise<void> {
    // Verify entries balance BEFORE hitting database
    this.verifyEntriesBalance(entries);

    await this.prisma.$transaction(async (tx) => {
      // Ensure or create ledger accounts for all entries
      const accountIds = new Map<string, string>();

      for (const entry of entries) {
        const accountKey = `${entry.accountType}:${entry.ownerId || 'null'}`;

        if (!accountIds.has(accountKey)) {
          const account = await tx.ledgerAccount.upsert({
            where: {
              type_ownerId: {
                type: entry.accountType,
                ownerId: entry.ownerId as any, // Prisma quirk: nullable fields in unique constraints
              },
            },
            create: {
              type: entry.accountType,
              ownerId: entry.ownerId ?? null,
            },
            update: {},
          });
          accountIds.set(accountKey, account.id);
        }
      }

      // Write all ledger entries
      const entryWrites = entries.map((entry) => {
        const accountKey = `${entry.accountType}:${entry.ownerId || 'null'}`;
        const accountId = accountIds.get(accountKey);

        if (!accountId) {
          throw new Error(`Account not found for ${accountKey}`);
        }

        return tx.ledgerEntry.create({
          data: {
            transactionId: paymentTransactionId,
            accountId,
            direction: entry.direction,
            amountKobo: entry.amountKobo,
          },
        });
      });

      await Promise.all(entryWrites);

      this.logger.log('Ledger entries written', {
        transactionId: paymentTransactionId,
        entryCount: entries.length,
      });
    });
  }

  /**
   * Get account balance for a specific account
   *
   * Balance = sum(CREDIT entries) - sum(DEBIT entries)
   *
   * For payable accounts (ENTERTAINER_PAYABLE, VENUE_PAYABLE):
   *   Positive balance = amount owed to owner
   *
   * For revenue accounts (PLATFORM_REVENUE):
   *   Positive balance = revenue earned
   */
  async getAccountBalance(accountType: LedgerAccountType, ownerId: string | null): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: {
        type_ownerId: {
          type: accountType,
          ownerId: ownerId as any, // Prisma quirk: nullable fields in unique constraints
        },
      },
      include: {
        entries: true,
      },
    });

    if (!account) {
      return 0;
    }

    let balance = 0;
    for (const entry of account.entries) {
      if (entry.direction === 'CREDIT') {
        balance += entry.amountKobo;
      } else {
        balance -= entry.amountKobo;
      }
    }

    return balance;
  }

  /**
   * Apply basis points to an amount
   *
   * CRITICAL: Integer arithmetic only - NO FLOATS
   * Uses integer division with proper rounding
   *
   * Example: 500000 kobo × 8500 bps / 10000 = 425000 kobo (₦4,250)
   */
  private applyBasisPoints(amountKobo: number, basisPoints: number): number {
    // Integer division: (amount * bps) / 10000
    // Add 5000 before division for proper rounding (equivalent to 0.5 in float world)
    return Math.floor((amountKobo * basisPoints) / 10000);
  }

  /**
   * Verify ledger entries balance
   *
   * Sum of all DEBIT entries MUST equal sum of all CREDIT entries
   * This is called before write and enforced at database transaction level
   */
  private verifyEntriesBalance(entries: LedgerEntrySpec[]): void {
    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      if (entry.direction === 'DEBIT') {
        totalDebits += entry.amountKobo;
      } else {
        totalCredits += entry.amountKobo;
      }
    }

    if (totalDebits !== totalCredits) {
      this.logger.error('Ledger entries do not balance', {
        totalDebits,
        totalCredits,
        difference: totalDebits - totalCredits,
        entries,
      });
      throw new BadRequestException(
        `Ledger entries do not balance: debits=${totalDebits}, credits=${totalCredits}`,
      );
    }

    this.logger.debug('Ledger entries verified as balanced', {
      totalDebits,
      totalCredits,
      entryCount: entries.length,
    });
  }
}
