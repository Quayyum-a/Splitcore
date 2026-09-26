import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-09-26T09:15:00.000Z');
const LAGOS_MIDNIGHT = '2026-09-25T23:00:00.000Z';

function buildHarness() {
  const prisma = {
    venue: { findUnique: jest.fn().mockResolvedValue({ id: 'venue-1', name: 'Quilox' }) },
    entertainer: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ent-1', stageName: 'DJ Neptune' }),
    },
    paymentTransaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { grossAmountKobo: 53750000 },
        _count: { _all: 183 },
      }),
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    venueEntertainer: { count: jest.fn().mockResolvedValue(7) },
    payout: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountKobo: 2100000 } }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ledgerAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'acct-1' }) },
    ledgerEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountKobo: 1000 } }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const service = new DashboardService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('DashboardService.venueOverview', () => {
  it('reports gross tips, count, entertainers and pending payouts in kobo', async () => {
    const h = buildHarness();

    const result = await h.service.venueOverview('venue-1', NOW);

    expect(result).toMatchObject({
      venueId: 'venue-1',
      venueName: 'Quilox',
      totalTipsKobo: 53750000,
      transactionCount: 183,
      entertainerCount: 7,
      pendingPayoutsKobo: 2100000,
    });
    // Integer kobo, never a float.
    expect(Number.isInteger(result.totalTipsKobo)).toBe(true);
  });

  it('windows tips to the Lagos calendar day', async () => {
    const h = buildHarness();

    await h.service.venueOverview('venue-1', NOW);

    const where = h.prisma.paymentTransaction.aggregate.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe(LAGOS_MIDNIGHT);
    expect(where.venueId).toBe('venue-1');
  });

  // Only settled money counts. Counting CREATED or FAILED transactions would
  // show a venue takings it never received.
  it('counts only SUCCESS transactions', async () => {
    const h = buildHarness();

    await h.service.venueOverview('venue-1', NOW);

    expect(h.prisma.paymentTransaction.aggregate.mock.calls[0][0].where.status).toBe('SUCCESS');
  });

  it('counts only active entertainers', async () => {
    const h = buildHarness();

    await h.service.venueOverview('venue-1', NOW);

    expect(h.prisma.venueEntertainer.count.mock.calls[0][0].where).toEqual({
      venueId: 'venue-1',
      entertainer: { isActive: true },
    });
  });

  // Pending payouts is a balance, so it deliberately has no date filter: money
  // owed from last week is still owed tonight.
  it('treats pending payouts as a current balance, not a windowed figure', async () => {
    const h = buildHarness();

    await h.service.venueOverview('venue-1', NOW);

    const where = h.prisma.payout.aggregate.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['QUEUED', 'RETRYING', 'PROCESSING']);
    expect(where.paymentTransaction).toEqual({ venueId: 'venue-1' });
    expect(where.createdAt).toBeUndefined();
  });

  it('reports zeroes rather than null for a venue with no activity', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.aggregate.mockResolvedValue({
      _sum: { grossAmountKobo: null },
      _count: { _all: 0 },
    });
    h.prisma.payout.aggregate.mockResolvedValue({ _sum: { amountKobo: null } });

    const result = await h.service.venueOverview('venue-1', NOW);

    expect(result.totalTipsKobo).toBe(0);
    expect(result.pendingPayoutsKobo).toBe(0);
  });

  it('404s for an unknown venue instead of inventing an empty one', async () => {
    const h = buildHarness();
    h.prisma.venue.findUnique.mockResolvedValue(null);

    await expect(h.service.venueOverview('nope', NOW)).rejects.toThrow(NotFoundException);
  });
});

describe('DashboardService.entertainerOverview', () => {
  it("sums the entertainer's own ledger credits, not gross tips", async () => {
    const h = buildHarness();
    h.prisma.ledgerEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amountKobo: 18400000 } }) // tonight
      .mockResolvedValueOnce({ _sum: { amountKobo: 42150000 } }) // this week
      .mockResolvedValueOnce({ _sum: { amountKobo: 214000000 } }); // total

    const result = await h.service.entertainerOverview('ent-1', NOW);

    expect(result.tonightKobo).toBe(18400000);
    expect(result.thisWeekKobo).toBe(42150000);
    expect(result.totalKobo).toBe(214000000);
    // CREDIT only: a payout debits the same account, and counting debits would
    // make earnings shrink as the entertainer got paid.
    expect(h.prisma.ledgerEntry.aggregate.mock.calls[0][0].where.direction).toBe('CREDIT');
  });

  it("reads only that entertainer's payable account", async () => {
    const h = buildHarness();

    await h.service.entertainerOverview('ent-1', NOW);

    expect(h.prisma.ledgerAccount.findFirst.mock.calls[0][0].where).toEqual({
      type: 'ENTERTAINER_PAYABLE',
      ownerId: 'ent-1',
    });
  });

  it('returns zeroes when nobody has tipped them yet', async () => {
    const h = buildHarness();
    h.prisma.ledgerAccount.findFirst.mockResolvedValue(null);

    const result = await h.service.entertainerOverview('ent-1', NOW);

    expect(result).toMatchObject({
      tonightKobo: 0,
      thisWeekKobo: 0,
      totalKobo: 0,
      pendingPayoutsKobo: 0,
      paidOutKobo: 0,
      stageName: 'DJ Neptune',
    });
  });

  it('separates what is owed from what has been paid', async () => {
    const h = buildHarness();
    h.prisma.payout.aggregate
      .mockResolvedValueOnce({ _sum: { amountKobo: 4750000 } }) // open
      .mockResolvedValueOnce({ _sum: { amountKobo: 209250000 } }); // succeeded

    const result = await h.service.entertainerOverview('ent-1', NOW);

    expect(result.pendingPayoutsKobo).toBe(4750000);
    expect(result.paidOutKobo).toBe(209250000);
  });

  it('404s for an unknown entertainer', async () => {
    const h = buildHarness();
    h.prisma.entertainer.findUnique.mockResolvedValue(null);

    await expect(h.service.entertainerOverview('nope', NOW)).rejects.toThrow(NotFoundException);
  });
});

describe('DashboardService.venueEntertainerEarnings', () => {
  it('converts BIGINT sums to integers', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([
      {
        entertainer_id: 'ent-1',
        stage_name: 'DJ Neptune',
        tonight_kobo: BigInt(18400000),
        week_kobo: BigInt(42150000),
        total_kobo: BigInt(214000000),
      },
    ]);

    const rows = await h.service.venueEntertainerEarnings('venue-1', NOW);

    expect(rows[0]).toEqual({
      entertainerId: 'ent-1',
      stageName: 'DJ Neptune',
      tonightKobo: 18400000,
      thisWeekKobo: 42150000,
      totalKobo: 214000000,
    });
    expect(typeof rows[0].totalKobo).toBe('number');
    expect(Number.isInteger(rows[0].totalKobo)).toBe(true);
  });

  it('treats a null sum as zero', async () => {
    const h = buildHarness();
    h.prisma.$queryRaw.mockResolvedValue([
      {
        entertainer_id: 'ent-2',
        stage_name: 'DJ Quiet',
        tonight_kobo: null,
        week_kobo: null,
        total_kobo: null,
      },
    ]);

    const rows = await h.service.venueEntertainerEarnings('venue-1', NOW);

    expect(rows[0].tonightKobo).toBe(0);
    expect(rows[0].totalKobo).toBe(0);
  });
});

describe('DashboardService transaction and payout history', () => {
  it("shows 'Anonymous' when the guest chose not to be named", async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findMany.mockResolvedValue([
      {
        id: 't1',
        createdAt: NOW,
        grossAmountKobo: 500000,
        entertainer: { stageName: 'DJ Neptune' },
        guestDisplayName: 'Ade',
        displayNameEnabled: false,
        status: 'SUCCESS',
        externalReference: 'pay_1',
      },
    ]);

    const page = await h.service.venueTransactions('venue-1');

    expect(page.items[0].guest).toBe('Anonymous');
  });

  it('uses the display name when the guest opted in', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findMany.mockResolvedValue([
      {
        id: 't1',
        createdAt: NOW,
        grossAmountKobo: 500000,
        entertainer: null,
        guestDisplayName: 'Ade',
        displayNameEnabled: true,
        status: 'SUCCESS',
        externalReference: 'pay_1',
      },
    ]);

    const page = await h.service.venueTransactions('venue-1');

    expect(page.items[0].guest).toBe('Ade');
    expect(page.items[0].entertainerName).toBeNull();
  });

  it('caps the page size so one request cannot ask for everything', async () => {
    const h = buildHarness();

    await h.service.venueTransactions('venue-1', 100000);

    expect(h.prisma.paymentTransaction.findMany.mock.calls[0][0].take).toBe(200);
  });

  it('falls back to the default page size for a nonsense limit', async () => {
    const h = buildHarness();

    await h.service.venueTransactions('venue-1', -5);

    expect(h.prisma.paymentTransaction.findMany.mock.calls[0][0].take).toBe(50);
  });

  it("scopes entertainer payouts to that entertainer's own payable account", async () => {
    const h = buildHarness();

    await h.service.entertainerPayouts('ent-1');

    expect(h.prisma.payout.findMany.mock.calls[0][0].where).toEqual({
      ledgerAccount: { type: 'ENTERTAINER_PAYABLE', ownerId: 'ent-1' },
    });
  });

  it('scopes entertainer transactions to that entertainer', async () => {
    const h = buildHarness();

    await h.service.entertainerTransactions('ent-1');

    expect(h.prisma.paymentTransaction.findMany.mock.calls[0][0].where).toEqual({
      entertainerId: 'ent-1',
    });
  });
});
