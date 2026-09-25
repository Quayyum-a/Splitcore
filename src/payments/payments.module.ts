import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaystackProvider } from './providers/paystack.provider';
import { PaystackPayoutProvider } from './providers/paystack-payout.provider';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Payments Module
 *
 * Handles payment initialization, verification, and status checking.
 * Provides payment and payout provider abstractions (Paystack as first implementation).
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaystackProvider, PaystackPayoutProvider],
  exports: [PaymentsService, PaystackProvider, PaystackPayoutProvider],
})
export class PaymentsModule {}
