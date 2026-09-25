import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentProvidersModule } from '../payments/providers/payment-providers.module';

/**
 * Reconciliation Module
 *
 * Ledger-vs-provider balance check. Scheduled as a BullMQ repeatable job in
 * the worker (JobSchedulerService), so it runs once per hour no matter how
 * many API instances are deployed.
 */
@Module({
  imports: [PrismaModule, LedgerModule, PaymentProvidersModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
