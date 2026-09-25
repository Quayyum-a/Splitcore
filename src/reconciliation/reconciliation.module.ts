import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

/**
 * Reconciliation Module
 *
 * Provides hourly balance checks against Paystack API.
 * Detects drift between our ledger and actual balances.
 */
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, LedgerModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
