/**
 * Unit tests for the hourly reconciliation report: what the ledger says we
 * hold at the processor versus what the processor says we hold.
 */

import { PrismaService } from '../prisma/prisma.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PayoutProvider } from '../payments/interfaces';
import { ReconciliationService } from './reconciliation.service';

function buildHarness(overrides: { balances?: Record<string, number> } = {}) {
  const balances: Record<string, number> = {
    PROCESSOR_CLEARING: 1000000,
    PLATFORM_REVENUE: 50000,
    ...overrides.balances,
  };

  const prisma = {
    payout: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountKobo: 0 } }) },
    $queryRaw: jest.fn().mockResolvedValue([{ total: BigInt(0) }]),
    ledgerAccount: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const ledgerRepository = {
    getTrialBalance: jest
      .fn()
      .mockResolvedValue({ totalDebitsKobo: 1000000, totalCreditsKobo: 1000000 }),
    getBalance: jest.fn(async (type: string) => balances[type] ?? 0),
  };

  const provider = { name: 'paystack', getBalance: jest.fn().mockResolvedValue(1000000) };

  const service = new ReconciliationService(
    prisma as unknown as PrismaService,
    ledgerRepository as unknown as LedgerRepository,
    provider as unknown as PayoutProvider,
  );

  return { service, prisma, ledgerRepository, provider };
}

describe('ReconciliationService.run', () => {
  it('reports a balanced trial balance when debits equal credits', async () => {
    const h = buildHarness();

    const report = await h.service.run();

    expect(report.trialBalanced).toBe(true);
    expect(report.totalDebitsKobo).toBe(report.totalCreditsKobo);
  });

  it('flags an unbalanced ledger', async () => {
    const h = buildHarness();
    h.ledgerRepository.getTrialBalance.mockResolvedValue({
      totalDebitsKobo: 1000000,
      totalCreditsKobo: 999999,
    });

    const report = await h.service.run();

    expect(report.trialBalanced).toBe(false);
  });

  it('expects the processor balance to exclude transfers already in flight', async () => {
    const h = buildHarness();
    h.prisma.payout.aggregate.mockResolvedValue({ _sum: { amountKobo: 200000 } });
    h.provider.getBalance.mockResolvedValue(800000);

    const report = await h.service.run();

    expect(report.inFlightPayoutsKobo).toBe(200000);
    expect(report.expectedProviderBalanceKobo).toBe(800000);
    expect(report.driftKobo).toBe(0);
  });

  it('reports drift rather than correcting it', async () => {
    // Processor fees are deducted per charge while the ledger posts the
    // gross, so some drift is expected; a person decides what it means.
    const h = buildHarness();
    h.provider.getBalance.mockResolvedValue(985000);

    const report = await h.service.run();

    expect(report.driftKobo).toBe(-15000);
  });

  it('treats no in-flight payouts as zero rather than null', async () => {
    const h = buildHarness();
    h.prisma.payout.aggregate.mockResolvedValue({ _sum: { amountKobo: null } });

    const report = await h.service.run();

    expect(report.inFlightPayoutsKobo).toBe(0);
  });

  it('stamps the report with the time it was taken', async () => {
    const h = buildHarness();

    const report = await h.service.run();

    expect(() => new Date(report.checkedAt).toISOString()).not.toThrow();
  });
});
