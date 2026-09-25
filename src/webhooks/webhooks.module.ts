import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookEventHandler } from './webhook-event-handler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { QueueModule } from '../queue/queue.module';

/**
 * Webhooks Module
 *
 * API side: WebhooksController + WebhooksService (verify, store, enqueue).
 * Worker side: WebhookEventHandler, driven by WebhooksProcessor, which is
 * registered only in QueueProcessorsModule.
 */
@Module({
  imports: [PrismaModule, PaymentsModule, PayoutsModule, QueueModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookEventHandler],
  exports: [WebhookEventHandler],
})
export class WebhooksModule {}
