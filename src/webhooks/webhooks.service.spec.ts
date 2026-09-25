/**
 * Unit tests for webhook ingest — the synchronous half of webhook handling.
 *
 * The rules being pinned: nothing unsigned is ever stored, a duplicate
 * delivery cannot create a second event, and an event is never
 * stored-but-forgotten.
 */

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProvider } from '../payments/interfaces';
import { WebhookEventHandler } from './webhook-event-handler.service';
import { WebhooksService } from './webhooks.service';

const RAW_BODY = Buffer.from('{"event":"charge.success"}');
const SIGNATURE = 'a-valid-signature';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function buildHarness({ queueEnabled = true }: { queueEnabled?: boolean } = {}) {
  const prisma = {
    webhookEvent: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const provider = {
    name: 'paystack',
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const handler = { handle: jest.fn().mockResolvedValue(undefined) };
  const configService = {
    get: jest.fn(() => queueEnabled),
  } as unknown as ConfigService;

  const service = new WebhooksService(
    prisma as unknown as PrismaService,
    provider as unknown as PaymentProvider,
    queue as never,
    handler as unknown as WebhookEventHandler,
    configService,
  );

  return { service, prisma, provider, queue, handler };
}

describe('WebhooksService.ingest', () => {
  describe('signature verification', () => {
    it('rejects a payload with no signature header, before touching the database', async () => {
      const h = buildHarness();

      await expect(
        h.service.ingest(RAW_BODY, undefined, { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow(UnauthorizedException);
      expect(h.prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a payload whose signature does not verify', async () => {
      const h = buildHarness();
      h.provider.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        h.service.ingest(RAW_BODY, 'forged', { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow(UnauthorizedException);
      expect(h.prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('verifies against the exact raw bytes the provider signed', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      await h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } });

      expect(h.provider.verifyWebhookSignature).toHaveBeenCalledWith(RAW_BODY, SIGNATURE);
    });
  });

  describe('payload shape', () => {
    it.each([
      ['missing event type', { data: { id: 1 } }],
      ['missing data identifier', { event: 'charge.success', data: {} }],
      ['no data at all', { event: 'charge.success' }],
    ])('rejects a payload with a %s', async (_label, payload) => {
      const h = buildHarness();

      await expect(h.service.ingest(RAW_BODY, SIGNATURE, payload)).rejects.toThrow(
        BadRequestException,
      );
      expect(h.prisma.webhookEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('storage and dedupe', () => {
    it('stores a signed event and queues it for processing', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      const result = await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'charge.success',
        data: { id: 302961 },
      });

      expect(result).toBe('queued');
      expect(h.prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'paystack',
          eventType: 'charge.success',
          externalEventId: 'paystack:charge.success:302961',
          signature: SIGNATURE,
        }),
      });
      expect(h.queue.add).toHaveBeenCalledWith(
        'process-webhook',
        { webhookEventId: 'evt-1' },
        expect.objectContaining({ jobId: 'webhook:evt-1' }),
      );
    });

    it('falls back to the reference when the payload carries no object id', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'transfer.success',
        data: { reference: 'po_abc_1' },
      });

      expect(h.prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          externalEventId: 'paystack:transfer.success:po_abc_1',
        }),
      });
    });

    it('treats a different event for the same object as a distinct event', async () => {
      // transfer.reversed for a transfer that earlier sent transfer.success
      // must not be deduped away.
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'transfer.success',
        data: { id: 77 },
      });
      await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'transfer.reversed',
        data: { id: 77 },
      });

      const ids = h.prisma.webhookEvent.create.mock.calls.map(
        (call) => call[0].data.externalEventId,
      );
      expect(new Set(ids).size).toBe(2);
    });

    it('reports a duplicate delivery without creating a second row', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockRejectedValue(uniqueViolation());
      h.prisma.webhookEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        processingStatus: 'COMPLETED',
      });

      const result = await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'charge.success',
        data: { id: 1 },
      });

      expect(result).toBe('duplicate');
      expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues a duplicate whose earlier delivery never completed', async () => {
      // Otherwise a webhook stored during a Redis outage is stored and
      // forgotten, and the payment never settles.
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockRejectedValue(uniqueViolation());
      h.prisma.webhookEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        processingStatus: 'FAILED',
      });

      const result = await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'charge.success',
        data: { id: 1 },
      });

      expect(result).toBe('duplicate');
      expect(h.queue.add).toHaveBeenCalledWith(
        'process-webhook',
        { webhookEventId: 'evt-1' },
        expect.anything(),
      );
    });

    it('propagates a database error that is not a duplicate', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('enqueue failures', () => {
    it('surfaces an enqueue failure so the provider retries', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      h.queue.add.mockRejectedValue(new Error('Connection is closed.'));

      await expect(
        h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow('Connection is closed.');
    });

    it('does not hang the webhook ack when the queue never responds', async () => {
      const h = buildHarness();
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      h.queue.add.mockImplementation(() => new Promise(() => {}));

      const started = Date.now();
      await expect(
        h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow(/Timed out/);

      expect(Date.now() - started).toBeLessThan(10000);
    }, 15000);
  });

  describe('with no queue (REDIS_ENABLED=false)', () => {
    it('processes the event inline instead of storing it for nobody', async () => {
      // There is no worker in this mode; without inline processing the
      // event would be stored and the payment would silently never settle.
      const h = buildHarness({ queueEnabled: false });
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      const result = await h.service.ingest(RAW_BODY, SIGNATURE, {
        event: 'charge.success',
        data: { id: 1 },
      });

      expect(result).toBe('queued');
      expect(h.handler.handle).toHaveBeenCalledWith('evt-1');
      expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('still stores the event before processing it', async () => {
      const h = buildHarness({ queueEnabled: false });
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      await h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } });

      expect(h.prisma.webhookEvent.create.mock.invocationCallOrder[0]).toBeLessThan(
        h.handler.handle.mock.invocationCallOrder[0],
      );
    });

    it('surfaces a processing failure so the provider retries', async () => {
      const h = buildHarness({ queueEnabled: false });
      h.prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      h.handler.handle.mockRejectedValue(new Error('paystack unreachable'));

      await expect(
        h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } }),
      ).rejects.toThrow('paystack unreachable');
    });

    it('re-processes a duplicate whose earlier delivery never completed', async () => {
      const h = buildHarness({ queueEnabled: false });
      h.prisma.webhookEvent.create.mockRejectedValue(uniqueViolation());
      h.prisma.webhookEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        processingStatus: 'FAILED',
      });

      await expect(
        h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } }),
      ).resolves.toBe('duplicate');
      expect(h.handler.handle).toHaveBeenCalledWith('evt-1');
    });

    it('does not re-process a duplicate that already completed', async () => {
      const h = buildHarness({ queueEnabled: false });
      h.prisma.webhookEvent.create.mockRejectedValue(uniqueViolation());
      h.prisma.webhookEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        processingStatus: 'COMPLETED',
      });

      await h.service.ingest(RAW_BODY, SIGNATURE, { event: 'charge.success', data: { id: 1 } });

      expect(h.handler.handle).not.toHaveBeenCalled();
    });
  });
});
