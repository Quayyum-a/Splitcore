import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentProvidersModule } from './providers/payment-providers.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SplitRulesModule } from '../split-rules/split-rules.module';
import { QueueModule } from '../queue/queue.module';

/**
 * Payments Module
 *
 * Guest checkout (initialize + status) and settlement: the single path by
 * which a payment becomes SUCCESS and its ledger entries are written.
 */
@Module({
  imports: [PrismaModule, PaymentProvidersModule, LedgerModule, SplitRulesModule, QueueModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentSettlementService],
  exports: [PaymentsService, PaymentSettlementService, PaymentProvidersModule],
})
export class PaymentsModule {}
