import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RECONCILIATION_QUEUE } from './queue.module';
import { PAYOUT_SWEEP_JOB, RECONCILE_JOB } from './payments.processors';

/**
 * Registers repeatable jobs when the worker starts. upsertJobScheduler is
 * idempotent, so restarts and multiple workers don't multiply schedules.
 */
@Injectable()
export class JobSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobSchedulerService.name);

  constructor(@InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'hourly-reconciliation',
      { pattern: '0 * * * *' },
      { name: RECONCILE_JOB, opts: { removeOnComplete: 48, removeOnFail: 168 } },
    );
    await this.queue.upsertJobScheduler(
      'payout-sweep',
      { every: 5 * 60 * 1000 },
      { name: PAYOUT_SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    this.logger.log('Repeatable jobs registered: hourly reconciliation, 5-minute payout sweep');
  }
}
