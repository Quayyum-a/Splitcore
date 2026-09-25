/**
 * Unit tests for the repeatable-job registration that runs when the worker
 * starts.
 */

import { JobSchedulerService } from './job-scheduler.service';
import { PAYOUT_SWEEP_JOB, RECONCILE_JOB } from './payments.processors';

describe('JobSchedulerService', () => {
  it('registers hourly reconciliation and the five-minute payout sweep', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    const service = new JobSchedulerService(queue as never);

    await service.onApplicationBootstrap();

    // upsert, not add: restarts and a second worker must not multiply schedules.
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'hourly-reconciliation',
      { pattern: '0 * * * *' },
      expect.objectContaining({ name: RECONCILE_JOB }),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'payout-sweep',
      { every: 300000 },
      expect.objectContaining({ name: PAYOUT_SWEEP_JOB }),
    );
  });
});
