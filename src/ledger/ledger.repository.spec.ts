/**
 * Unit tests for ledger persistence.
 *
 * The database independently enforces balance and immutability (see the
 * phase3_ledger_integrity migration and the payments e2e suite); these cover
 * the code-side contract: postings take the caller's transaction, accounts
 * are resolved without a read-then-insert race, and balances are read in the
 * account's normal sense.
 */

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerEntrySpec, LedgerService, UnbalancedLedgerError } from './ledger.service';
import { LedgerRepository } from './ledger.repository';

function buildHarness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    ledgerAccount: {
      findFirst: jest
        .fn()
        .mockImplementation(
          async ({ where }: { where: { type: string; ownerId: string | null } }) => ({
            id: `acct-${where.type}-${where.ownerId ?? 'system'}`,
          }),
        ),
    },
    ledgerEntry: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };

  const prisma = { $queryRaw: jest.fn() };

  const repository = new LedgerRepository(prisma as unknown as PrismaService, new LedgerService());

  return { repository, prisma, tx };
}

const BALANCED: LedgerEntrySpec[] = [
  { accountType: 'PROCESSOR_CLEARING', ownerId: null, direction: 'DEBIT', amountKobo: 500000 },
  { accountType: 'ENTERTAINER_PAYABLE', ownerId: 'ent-1', direction: 'CREDIT', amountKobo: 500000 },
];

describe('LedgerRepository.post', () => {
  it('refuses an unbalanced posting before touching the database', async () => {
    const h = buildHarness();

    await expect(
      h.repository.post(h.tx as unknown as Prisma.TransactionClient, 'txn-1', [BALANCED[0]]),
    ).rejects.toThrow(UnbalancedLedgerError);
    expect(h.tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('writes every entry against its resolved account, in one createMany', async () => {
    const h = buildHarness();

    await h.repository.post(h.tx as unknown as Prisma.TransactionClient, 'txn-1', BALANCED);

    expect(h.tx.ledgerEntry.createMany).toHaveBeenCalledTimes(1);
    expect(h.tx.ledgerEntry.createMany.mock.calls[0][0].data).toEqual([
      {
        transactionId: 'txn-1',
        accountId: 'acct-PROCESSOR_CLEARING-system',
        direction: 'DEBIT',
        amountKobo: 500000,
      },
      {
        transactionId: 'txn-1',
        accountId: 'acct-ENTERTAINER_PAYABLE-ent-1',
        direction: 'CREDIT',
        amountKobo: 500000,
      },
    ]);
  });

  it('resolves each distinct account only once per posting', async () => {
    const h = buildHarness();
    const entries: LedgerEntrySpec[] = [
      ...BALANCED,
      { accountType: 'PROCESSOR_CLEARING', ownerId: null, direction: 'DEBIT', amountKobo: 100 },
      {
        accountType: 'ENTERTAINER_PAYABLE',
        ownerId: 'ent-1',
        direction: 'CREDIT',
        amountKobo: 100,
      },
    ];

    await h.repository.post(h.tx as unknown as Prisma.TransactionClient, 'txn-1', entries);

    expect(h.tx.ledgerAccount.findFirst).toHaveBeenCalledTimes(2);
  });

  it('uses the transaction client it is given, never its own connection', async () => {
    // A posting must commit or roll back with the state change that caused it.
    const h = buildHarness();

    await h.repository.post(h.tx as unknown as Prisma.TransactionClient, 'txn-1', BALANCED);

    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('LedgerRepository.resolveAccountId', () => {
  it('inserts-or-ignores before reading, so a concurrent create cannot lose', async () => {
    const h = buildHarness();

    const id = await h.repository.resolveAccountId(
      h.tx as unknown as Prisma.TransactionClient,
      'ENTERTAINER_PAYABLE',
      'ent-1',
    );

    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(id).toBe('acct-ENTERTAINER_PAYABLE-ent-1');
    expect(h.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      h.tx.ledgerAccount.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('resolves a system account that has no owner', async () => {
    const h = buildHarness();

    await expect(
      h.repository.resolveAccountId(
        h.tx as unknown as Prisma.TransactionClient,
        'PLATFORM_REVENUE',
        null,
      ),
    ).resolves.toBe('acct-PLATFORM_REVENUE-system');
  });
});

describe('LedgerRepository.getBalance', () => {
  it('reports a payable balance as the amount still owed', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([
      { direction: 'CREDIT', total: BigInt(500000) },
      { direction: 'DEBIT', total: BigInt(100000) },
    ]);

    await expect(h.repository.getBalance('ENTERTAINER_PAYABLE', 'ent-1')).resolves.toBe(400000);
  });

  it('reports clearing as a debit-normal asset', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([
      { direction: 'DEBIT', total: BigInt(500000) },
      { direction: 'CREDIT', total: BigInt(425000) },
    ]);

    await expect(h.repository.getBalance('PROCESSOR_CLEARING', null)).resolves.toBe(75000);
  });

  it('is zero for an account with no entries', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([]);

    await expect(h.repository.getBalance('VENUE_PAYABLE', 'venue-1')).resolves.toBe(0);
  });
});

describe('LedgerRepository.getTrialBalance', () => {
  it('returns total debits and credits as numbers', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([{ debits: BigInt(1000000), credits: BigInt(1000000) }]);

    await expect(h.repository.getTrialBalance()).resolves.toEqual({
      totalDebitsKobo: 1000000,
      totalCreditsKobo: 1000000,
    });
  });

  it('surfaces an imbalance rather than hiding it', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([{ debits: BigInt(1000000), credits: BigInt(999999) }]);

    const trial = await h.repository.getTrialBalance();

    expect(trial.totalDebitsKobo).not.toBe(trial.totalCreditsKobo);
  });
});
