import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentProvidersModule } from '../payments/providers/payment-providers.module';
import { LedgerModule } from '../ledger/ledger.module';
import { QueueModule } from '../queue/queue.module';

/**
 * Payouts Module
 *
 * Per-tip transfers via the PayoutProvider abstraction, debiting the ledger
 * only on confirmed delivery.
 */
@Module({
  imports: [PrismaModule, PaymentProvidersModule, LedgerModule, QueueModule],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
