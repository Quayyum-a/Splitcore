import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PAYOUT_PROVIDER, PayoutProvider } from '../payments/interfaces';

export interface ReconciliationReport {
  checkedAt: string;
  /** Sum of all debits vs all credits; must be equal (enforced per posting by the DB). */
  trialBalanced: boolean;
  totalDebitsKobo: number;
  totalCreditsKobo: number;
  /** Money the ledger says is held at the processor. */
  ledgerClearingKobo: number;
  /** Transfers the processor has debited but not yet confirmed to us. */
  inFlightPayoutsKobo: number;
  /** ledgerClearingKobo - inFlightPayoutsKobo */
  expectedProviderBalanceKobo: number;
  providerBalanceKobo: number;
  /** providerBalanceKobo - expectedProviderBalanceKobo */
  driftKobo: number;
  /** What's still owed out, for context when reading drift. */
  entertainerPayableKobo: number;
  venuePayableKobo: number;
  platformRevenueKobo: number;
}

/**
 * Reconciliation: compares what the ledger says we hold at the processor
 * with what the processor says we hold. Runs hourly in the worker (BullMQ
 * repeatable job, see JobSchedulerService).
 *
 * Known, expected sources of non-zero drift until modelled in the ledger:
 * - processor fees deducted from each charge (ledger posts the gross)
 * - charges not yet settled into the transferable balance
 * - any float topped up manually to fund instant payouts
 * Drift is reported, not auto-corrected; a person decides what it means.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerRepository: LedgerRepository,
    @Inject(PAYOUT_PROVIDER) private readonly payoutProvider: PayoutProvider,
  ) {}

  async run(): Promise<ReconciliationReport> {
    const trial = await this.ledgerRepository.getTrialBalance();
    const [ledgerClearingKobo, entertainerPayableKobo, venuePayableKobo, platformRevenueKobo] =
      await Promise.all([
        this.ledgerRepository.getBalance('PROCESSOR_CLEARING', null),
        this.sumByType('ENTERTAINER_PAYABLE'),
        this.sumByType('VENUE_PAYABLE'),
        this.ledgerRepository.getBalance('PLATFORM_REVENUE', null),
      ]);

    const inFlight = await this.prisma.payout.aggregate({
      where: { status: 'PROCESSING' },
      _sum: { amountKobo: true },
    });
    const inFlightPayoutsKobo = inFlight._sum.amountKobo ?? 0;

    const providerBalanceKobo = await this.payoutProvider.getBalance();
    const expectedProviderBalanceKobo = ledgerClearingKobo - inFlightPayoutsKobo;

    const report: ReconciliationReport = {
      checkedAt: new Date().toISOString(),
      trialBalanced: trial.totalDebitsKobo === trial.totalCreditsKobo,
      totalDebitsKobo: trial.totalDebitsKobo,
      totalCreditsKobo: trial.totalCreditsKobo,
      ledgerClearingKobo,
      inFlightPayoutsKobo,
      expectedProviderBalanceKobo,
      providerBalanceKobo,
      driftKobo: providerBalanceKobo - expectedProviderBalanceKobo,
      entertainerPayableKobo,
      venuePayableKobo,
      platformRevenueKobo,
    };

    if (!report.trialBalanced) {
      this.logger.error('RECONCILIATION: ledger trial balance is off', report);
    } else if (report.driftKobo !== 0) {
      this.logger.error('RECONCILIATION DRIFT between ledger and provider balance', report);
    } else {
      this.logger.log('Reconciliation passed', report);
    }

    return report;
  }

  private async sumByType(type: 'ENTERTAINER_PAYABLE' | 'VENUE_PAYABLE'): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ balance: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount_kobo" ELSE -e."amount_kobo" END), 0)::bigint AS balance
        FROM "ledger_entries" e
        JOIN "ledger_accounts" a ON a."id" = e."account_id"
       WHERE a."type" = ${type}::"LedgerAccountType"`;
    return Number(row.balance);
  }
}
