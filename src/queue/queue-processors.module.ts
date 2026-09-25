import { Module } from '@nestjs/common';
import { DiagnosticsProcessor } from './diagnostics.processor';
import {
  WebhooksProcessor,
  PayoutsProcessor,
  ReconciliationProcessor,
} from './payments.processors';
import { JobSchedulerService } from './job-scheduler.service';
import { QueueModule } from './queue.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

/**
 * QueueProcessorsModule registers all BullMQ job processors.
 *
 * IMPORTANT: This module should ONLY be imported by WorkerModule.
 * DO NOT import this in AppModule (API server).
 *
 * When a processor is registered, BullMQ starts a worker that polls
 * Redis for jobs. This should only happen in the worker process,
 * not the API server.
 *
 * To add a new processor:
 * 1. Create the processor class with @Processor(queueName)
 * 2. Register the queue in QueueModule
 * 3. Add the processor to the providers array below
 */
@Module({
  imports: [QueueModule, WebhooksModule, PayoutsModule, ReconciliationModule],
  providers: [
    DiagnosticsProcessor,
    WebhooksProcessor,
    PayoutsProcessor,
    ReconciliationProcessor,
    JobSchedulerService,
  ],
  exports: [DiagnosticsProcessor],
})
export class QueueProcessorsModule {}
