import { Module } from '@nestjs/common';
import { DiagnosticsProcessor } from './diagnostics.processor';

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
  providers: [DiagnosticsProcessor],
  exports: [DiagnosticsProcessor],
})
export class QueueProcessorsModule {}
