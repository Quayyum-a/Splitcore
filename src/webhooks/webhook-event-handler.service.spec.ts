/**
 * Unit tests for the worker-side webhook handler: which event routes where,
 * and what happens when processing fails.
 */

import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentSettlementService,
  SettlementIntegrityError,
} from '../payments/payment-settlement.service';
import { PayoutsService } from '../payouts/payouts.service';
import { WebhookEventHandler } from './webhook-event-handler.service';

function buildHarness() {
  const prisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const settlement = { settle: jest.fn().mockResolvedValue(null) };
  const payouts = { handleTransferEvent: jest.fn().mockResolvedValue(undefined) };

  const handler = new WebhookEventHandler(
    prisma as unknown as PrismaService,
    settlement as unknown as PaymentSettlementService,
    payouts as unknown as PayoutsService,
  );

  return { handler, prisma, settlement, payouts };
}

function storedEvent(eventType: string, reference: string | null = 'pay_ref_1') {
  return {
    id: 'evt-1',
    eventType,
    processingStatus: 'PENDING',
    payload: { event: eventType, data: reference ? { reference } : {} },
  };
}

function statusUpdates(prisma: ReturnType<typeof buildHarness>['prisma']): string[] {
  return prisma.webhookEvent.update.mock.calls.map((call) => call[0].data.processingStatus);
}

describe('WebhookEventHandler.handle', () => {
  it('does nothing for an unknown event id', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(null);

    await h.handler.handle('missing');

    expect(h.prisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an event already COMPLETED', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue({
      ...storedEvent('charge.success'),
      processingStatus: 'COMPLETED',
    });

    await h.handler.handle('evt-1');

    expect(h.settlement.settle).not.toHaveBeenCalled();
    expect(h.prisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  it('routes charge.success through settlement and marks the event COMPLETED', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(storedEvent('charge.success'));

    await h.handler.handle('evt-1');

    expect(h.settlement.settle).toHaveBeenCalledWith('pay_ref_1');
    expect(statusUpdates(h.prisma)).toEqual(['PROCESSING', 'COMPLETED']);
  });

  it.each([
    ['transfer.success', 'success'],
    ['transfer.failed', 'failed'],
    ['transfer.reversed', 'reversed'],
  ])('routes %s to the payout handler as %s', async (eventType, outcome) => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(storedEvent(eventType, 'po_abc_1'));

    await h.handler.handle('evt-1');

    expect(h.payouts.handleTransferEvent).toHaveBeenCalledWith('po_abc_1', outcome);
    expect(statusUpdates(h.prisma)).toContain('COMPLETED');
  });

  it('completes an unhandled event type without touching the money path', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(
      storedEvent('customeridentification.success'),
    );

    await h.handler.handle('evt-1');

    expect(h.settlement.settle).not.toHaveBeenCalled();
    expect(h.payouts.handleTransferEvent).not.toHaveBeenCalled();
    expect(statusUpdates(h.prisma)).toContain('COMPLETED');
  });

  it('completes an event carrying no reference rather than retrying forever', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(storedEvent('charge.success', null));

    await h.handler.handle('evt-1');

    expect(h.settlement.settle).not.toHaveBeenCalled();
    expect(statusUpdates(h.prisma)).toContain('COMPLETED');
  });

  it('parks an integrity failure for a human instead of retrying', async () => {
    // Retrying cannot fix an amount or currency mismatch.
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(storedEvent('charge.success'));
    h.settlement.settle.mockRejectedValue(
      new SettlementIntegrityError('Amount mismatch', 'pay_ref_1'),
    );

    await expect(h.handler.handle('evt-1')).resolves.toBeUndefined();

    expect(statusUpdates(h.prisma)).toEqual(['PROCESSING', 'FAILED']);
  });

  it('rethrows a transient failure so BullMQ retries it', async () => {
    const h = buildHarness();
    h.prisma.webhookEvent.findUnique.mockResolvedValue(storedEvent('charge.success'));
    h.settlement.settle.mockRejectedValue(new Error('provider timeout'));

    await expect(h.handler.handle('evt-1')).rejects.toThrow('provider timeout');

    expect(statusUpdates(h.prisma)).toEqual(['PROCESSING', 'FAILED']);
  });
});
