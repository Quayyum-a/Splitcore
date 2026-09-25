import { Injectable } from '@nestjs/common';
import { LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerEntrySpec, LedgerService } from './ledger.service';

export interface TrialBalance {
  totalDebitsKobo: number;
  totalCreditsKobo: number;
}

/**
 * Ledger persistence. Every write takes the caller's transaction client, so
 * a posting commits or rolls back together with the state change that
 * caused it (payment -> SUCCESS, payout -> SUCCESS).
 */
@Injectable()
export class LedgerRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async post(
    tx: Prisma.TransactionClient,
    transactionId: string,
    entries: LedgerEntrySpec[],
  ): Promise<void> {
    // Checked here for a clear error; the deferred DB trigger re-checks at
    // commit regardless of what this code does.
    this.ledger.assertBalanced(entries);

    const accountIds = new Map<string, string>();
    for (const entry of entries) {
      const key = `${entry.accountType}:${entry.ownerId ?? ''}`;
      if (!accountIds.has(key)) {
        accountIds.set(key, await this.resolveAccountId(tx, entry.accountType, entry.ownerId));
      }
    }

    await tx.ledgerEntry.createMany({
      data: entries.map((entry) => ({
        transactionId,
        accountId: accountIds.get(`${entry.accountType}:${entry.ownerId ?? ''}`)!,
        direction: entry.direction,
        amountKobo: entry.amountKobo,
      })),
    });
  }

  /**
   * Find-or-create an account without a read-then-insert race. A unique
   * violation inside an interactive transaction aborts the whole
   * transaction, so this uses ON CONFLICT DO NOTHING instead of catching.
   */
  async resolveAccountId(
    tx: Prisma.TransactionClient,
    type: LedgerAccountType,
    ownerId: string | null,
  ): Promise<string> {
    if (ownerId === null) {
      await tx.$executeRaw`
        INSERT INTO "ledger_accounts" ("id", "type", "owner_id")
        VALUES (gen_random_uuid()::text, ${type}::"LedgerAccountType", NULL)
        ON CONFLICT ("type") WHERE "owner_id" IS NULL DO NOTHING`;
    } else {
      await tx.$executeRaw`
        INSERT INTO "ledger_accounts" ("id", "type", "owner_id")
        VALUES (gen_random_uuid()::text, ${type}::"LedgerAccountType", ${ownerId})
        ON CONFLICT ("type", "owner_id") DO NOTHING`;
    }

    const account = await tx.ledgerAccount.findFirst({
      where: { type, ownerId },
      select: { id: true },
    });
    return account!.id;
  }

  /**
   * Balance in the account's normal sense (see LedgerService.balanceOf):
   * for a payable account, the amount still owed to its owner.
   */
  async getBalance(type: LedgerAccountType, ownerId: string | null): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{ direction: 'DEBIT' | 'CREDIT'; total: bigint }>
    >`
      SELECT e."direction", SUM(e."amount_kobo")::bigint AS total
        FROM "ledger_entries" e
        JOIN "ledger_accounts" a ON a."id" = e."account_id"
       WHERE a."type" = ${type}::"LedgerAccountType"
         AND a."owner_id" IS NOT DISTINCT FROM ${ownerId}
       GROUP BY e."direction"`;

    return this.ledger.balanceOf(
      type,
      rows.map((r) => ({ direction: r.direction, amountKobo: Number(r.total) })),
    );
  }

  /** Sum of every debit and every credit in the ledger; must be equal. */
  async getTrialBalance(): Promise<TrialBalance> {
    const [row] = await this.prisma.$queryRaw<Array<{ debits: bigint; credits: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount_kobo" END), 0)::bigint AS debits,
             COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount_kobo" END), 0)::bigint AS credits
        FROM "ledger_entries"`;
    return { totalDebitsKobo: Number(row.debits), totalCreditsKobo: Number(row.credits) };
  }
}
