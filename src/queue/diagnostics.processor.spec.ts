import { Job } from 'bullmq';
import { DiagnosticsProcessor } from './diagnostics.processor';

describe('DiagnosticsProcessor', () => {
  it('acknowledges a ping with the time it was received', async () => {
    const processor = new DiagnosticsProcessor();

    const result = await processor.process({
      id: 'job-1',
      data: { pingedAt: new Date().toISOString() },
    } as Job<{ pingedAt: string }>);

    expect(() => new Date(result.receivedAt).toISOString()).not.toThrow();
  });
});
