import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './webhooks.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutsModule } from '../payouts/payouts.module';

/**
 * Webhooks Module
 *
 * Handles incoming webhooks from payment providers.
 * Provides signature verification, idempotency, and async processing.
 */
@Module({
  imports: [
    PrismaModule,
    PaymentsModule, // For PaystackProvider
    LedgerModule, // For LedgerService
    PayoutsModule, // For PayoutsService
    BullModule.registerQueue({
      name: 'webhooks',
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
