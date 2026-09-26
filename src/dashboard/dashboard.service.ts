import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { thisWeek, tonight } from './time-window';
import {
  EntertainerEarningsRowDto,
  EntertainerOverviewResponseDto,
  PayoutRowDto,
  TransactionRowDto,
  VenueOverviewResponseDto,
} from './dto/dashboard.dto';

/** Owed, but not yet successfully transferred. */
const OPEN_PAYOUT_STATUSES: PayoutStatus[] = [
  PayoutStatus.QUEUED,
  PayoutStatus.RETRYING,
  PayoutStatus.PROCESSING,
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Read-only aggregates for the venue and entertainer dashboards.
 *
 * Two rules throughout:
 *
 *  1. Every figure is summed in the database, in integer kobo. Nothing is
 *     assembled client-side from partial data, and no intermediate value is
 *     ever a float - this is money, and a dashboard that quietly shows a wrong
 *     number is worse than one that shows nothing.
 *
 *  2. A venue's "total tips" is gross takings, while an entertainer's earnings
 *     are their own share, read from the ledger rather than from the payment. A
 *     tip's gross and an entertainer's cut are different numbers and must never
 *     be confused: the ledger is the only place the split has actually been
 *     applied.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async venueOverview(venueId: string, now = new Date()): Promise<VenueOverviewResponseDto> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);

    const window = tonight(now);

    const [tips, entertainerCount, pending] = await Promise.all([
      this.prisma.paymentTransaction.aggregate({
        where: {
          venueId,
          status: PaymentStatus.SUCCESS,
          createdAt: { gte: window.from, lte: window.to },
        },
        _sum: { grossAmountKobo: true },
        _count: { _all: true },
      }),
      this.prisma.venueEntertainer.count({
        where: { venueId, entertainer: { isActive: true } },
      }),
      // Attributed through the payment, so this is money owed because of
      // transactions AT THIS VENUE - covering both the venue's own payable and
      // its entertainers'. A balance as it stands, not a figure for the window.
      this.prisma.payout.aggregate({
        where: {
          status: { in: OPEN_PAYOUT_STATUSES },
          paymentTransaction: { venueId },
        },
        _sum: { amountKobo: true },
      }),
    ]);

    return {
      venueId,
      venueName: venue.name,
      windowFrom: window.from,
      windowTo: window.to,
      totalTipsKobo: tips._sum.grossAmountKobo ?? 0,
      transactionCount: tips._count._all,
      entertainerCount,
      pendingPayoutsKobo: pending._sum.amountKobo ?? 0,
    };
  }

  /**
   * Per-entertainer earnings for one venue, over three windows.
   *
   * Sums the entertainer's ledger credits rather than the gross tip, and only
   * those arising from payments at this venue - an entertainer who also performs
   * elsewhere must not have that income shown to this venue.
   */
  async venueEntertainerEarnings(
    venueId: string,
    now = new Date(),
  ): Promise<EntertainerEarningsRowDto[]> {
    const night = tonight(now);
    const week = thisWeek(now);

    const rows = await this.prisma.$queryRaw<
      Array<{
        entertainer_id: string;
        stage_name: string;
        tonight_kobo: bigint | null;
        week_kobo: bigint | null;
        total_kobo: bigint | null;
      }>
    >(Prisma.sql`
      SELECT e.id                              AS entertainer_id,
             e.stage_name                      AS stage_name,
             COALESCE(SUM(CASE WHEN le.created_at >= ${night.from} THEN le.amount_kobo END), 0) AS tonight_kobo,
             COALESCE(SUM(CASE WHEN le.created_at >= ${week.from}  THEN le.amount_kobo END), 0) AS week_kobo,
             COALESCE(SUM(le.amount_kobo), 0)  AS total_kobo
        FROM venue_entertainers ve
        JOIN entertainers e ON e.id = ve.entertainer_id
        LEFT JOIN ledger_accounts la
               ON la.owner_id = e.id AND la.type = 'ENTERTAINER_PAYABLE'
        LEFT JOIN ledger_entries le
               ON le.account_id = la.id AND le.direction = 'CREDIT'
        LEFT JOIN payment_transactions pt
               ON pt.id = le.transaction_id AND pt.venue_id = ${venueId}
       WHERE ve.venue_id = ${venueId}
         AND e.is_active = true
         AND (le.id IS NULL OR pt.id IS NOT NULL)
       GROUP BY e.id, e.stage_name
       ORDER BY total_kobo DESC, e.stage_name ASC
    `);

    return rows.map((r) => ({
      entertainerId: r.entertainer_id,
      stageName: r.stage_name,
      // BIGINT arrives as a JS BigInt; kobo totals are far inside Number's safe
      // integer range, and Number() keeps them integers.
      tonightKobo: Number(r.tonight_kobo ?? 0),
      thisWeekKobo: Number(r.week_kobo ?? 0),
      totalKobo: Number(r.total_kobo ?? 0),
    }));
  }

  async entertainerOverview(
    entertainerId: string,
    now = new Date(),
  ): Promise<EntertainerOverviewResponseDto> {
    const entertainer = await this.prisma.entertainer.findUnique({ where: { id: entertainerId } });
    if (!entertainer) throw new NotFoundException(`Entertainer ${entertainerId} not found`);

    const night = tonight(now);
    const week = thisWeek(now);

    // One account per entertainer: (type, owner_id) is unique.
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: 'ENTERTAINER_PAYABLE', ownerId: entertainerId },
    });

    if (!account) {
      // No account yet simply means nobody has tipped them. Zeroes are the
      // honest answer, not an error.
      return {
        entertainerId,
        stageName: entertainer.stageName,
        tonightKobo: 0,
        thisWeekKobo: 0,
        totalKobo: 0,
        pendingPayoutsKobo: 0,
        paidOutKobo: 0,
      };
    }

    const creditsIn = (from?: Date) =>
      this.prisma.ledgerEntry.aggregate({
        where: {
          accountId: account.id,
          direction: 'CREDIT',
          ...(from ? { createdAt: { gte: from, lte: now } } : {}),
        },
        _sum: { amountKobo: true },
      });

    const [tonightSum, weekSum, totalSum, pending, paid] = await Promise.all([
      creditsIn(night.from),
      creditsIn(week.from),
      creditsIn(),
      this.prisma.payout.aggregate({
        where: { ledgerAccountId: account.id, status: { in: OPEN_PAYOUT_STATUSES } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payout.aggregate({
        where: { ledgerAccountId: account.id, status: PayoutStatus.SUCCESS },
        _sum: { amountKobo: true },
      }),
    ]);

    return {
      entertainerId,
      stageName: entertainer.stageName,
      tonightKobo: tonightSum._sum.amountKobo ?? 0,
      thisWeekKobo: weekSum._sum.amountKobo ?? 0,
      totalKobo: totalSum._sum.amountKobo ?? 0,
      pendingPayoutsKobo: pending._sum.amountKobo ?? 0,
      paidOutKobo: paid._sum.amountKobo ?? 0,
    };
  }

  async venueTransactions(venueId: string, limit?: number, offset?: number) {
    return this.transactions({ venueId }, limit, offset);
  }

  async entertainerTransactions(entertainerId: string, limit?: number, offset?: number) {
    return this.transactions({ entertainerId }, limit, offset);
  }

  private async transactions(
    where: Prisma.PaymentTransactionWhereInput,
    limit = DEFAULT_LIMIT,
    offset = 0,
  ) {
    const take = clamp(limit);
    const skip = Math.max(0, offset);

    const [total, rows] = await Promise.all([
      this.prisma.paymentTransaction.count({ where }),
      this.prisma.paymentTransaction.findMany({
        where,
        include: { entertainer: { select: { stageName: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    const items: TransactionRowDto[] = rows.map((t) => ({
      id: t.id,
      time: t.createdAt,
      amountKobo: t.grossAmountKobo,
      entertainerName: t.entertainer?.stageName ?? null,
      // A guest who chose not to be named is shown as Anonymous rather than
      // having their name leak because a flag was checked in the wrong place.
      guest: t.displayNameEnabled && t.guestDisplayName ? t.guestDisplayName : 'Anonymous',
      status: t.status,
      reference: t.externalReference,
    }));

    return { total, limit: take, offset: skip, items };
  }

  async venuePayouts(venueId: string, limit?: number, offset?: number) {
    return this.payouts({ paymentTransaction: { venueId } }, limit, offset);
  }

  async entertainerPayouts(entertainerId: string, limit?: number, offset?: number) {
    return this.payouts(
      { ledgerAccount: { type: 'ENTERTAINER_PAYABLE', ownerId: entertainerId } },
      limit,
      offset,
    );
  }

  private async payouts(where: Prisma.PayoutWhereInput, limit = DEFAULT_LIMIT, offset = 0) {
    const take = clamp(limit);
    const skip = Math.max(0, offset);

    const [total, rows] = await Promise.all([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        include: {
          paymentTransaction: { include: { entertainer: { select: { stageName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    const items: PayoutRowDto[] = rows.map((p) => ({
      id: p.id,
      entertainerName: p.paymentTransaction?.entertainer?.stageName ?? null,
      amountKobo: p.amountKobo,
      status: p.status,
      reference: p.transferReference,
      time: p.createdAt,
      failureReason: p.failureReason,
    }));

    return { total, limit: take, offset: skip, items };
  }
}

function clamp(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
