import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DIAGNOSTICS_QUEUE } from './queue.module';

@Processor(DIAGNOSTICS_QUEUE)
export class DiagnosticsProcessor extends WorkerHost {
  private readonly logger = new Logger(DiagnosticsProcessor.name);

  async process(job: Job<{ pingedAt: string }>): Promise<{ receivedAt: string }> {
    this.logger.log(`Processing diagnostics job ${job.id}, sent at ${job.data.pingedAt}`);
    return { receivedAt: new Date().toISOString() };
  }
}
