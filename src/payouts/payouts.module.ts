import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * Payouts Module
 *
 * Handles payout creation and processing.
 * Integrates with Paystack Transfers API for instant payouts.
 */
@Module({
  imports: [PrismaModule, PaymentsModule],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
