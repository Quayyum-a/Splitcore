/**
 * Unit tests for the webhook endpoint's request handling.
 */

import { BadRequestException, RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

const PAYLOAD = { event: 'charge.success', data: { id: 1, reference: 'pay_ref_1' } };
const RAW = Buffer.from(JSON.stringify(PAYLOAD));

function build() {
  const service = { ingest: jest.fn().mockResolvedValue('queued') };
  return { controller: new WebhooksController(service as unknown as WebhooksService), service };
}

const requestWith = (rawBody?: Buffer) => ({ rawBody }) as RawBodyRequest<Request>;

describe('WebhooksController', () => {
  it('acks a signed webhook once ingest has stored it', async () => {
    const { controller, service } = build();

    await expect(
      controller.handlePaystackWebhook(requestWith(RAW), 'sig', PAYLOAD),
    ).resolves.toEqual({ received: true });
    expect(service.ingest).toHaveBeenCalledWith(RAW, 'sig', PAYLOAD);
  });

  it('verifies against the raw bytes, not a re-serialized body', async () => {
    // A re-serialized object would not match the signature the provider computed.
    const { controller, service } = build();

    await controller.handlePaystackWebhook(requestWith(RAW), 'sig', PAYLOAD);

    expect(service.ingest.mock.calls[0][0]).toBe(RAW);
  });

  it('refuses a request whose raw body was not captured', async () => {
    const { controller, service } = build();

    await expect(
      controller.handlePaystackWebhook(requestWith(undefined), 'sig', PAYLOAD),
    ).rejects.toThrow(BadRequestException);
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('acks a duplicate delivery the same way, so the provider stops retrying', async () => {
    const { controller, service } = build();
    service.ingest.mockResolvedValue('duplicate');

    await expect(
      controller.handlePaystackWebhook(requestWith(RAW), 'sig', PAYLOAD),
    ).resolves.toEqual({ received: true });
  });

  it('lets a rejected signature surface as 401 rather than acking it', async () => {
    const { controller, service } = build();
    service.ingest.mockRejectedValue(new UnauthorizedException('Invalid webhook signature'));

    await expect(
      controller.handlePaystackWebhook(requestWith(RAW), 'forged', PAYLOAD),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('lets an enqueue failure surface so the provider retries', async () => {
    const { controller, service } = build();
    service.ingest.mockRejectedValue(new Error('Connection is closed.'));

    await expect(
      controller.handlePaystackWebhook(requestWith(RAW), 'sig', PAYLOAD),
    ).rejects.toThrow('Connection is closed.');
  });
});
