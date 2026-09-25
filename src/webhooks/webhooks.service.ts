import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/interfaces';
import { WEBHOOKS_QUEUE } from '../queue/queue.module';
import { withTimeout } from '../common/utils/with-timeout';
import { WebhookEventHandler } from './webhook-event-handler.service';

const ENQUEUE_TIMEOUT_MS = 2000;

export interface WebhookJobData {
  webhookEventId: string;
}

export interface PaystackWebhookPayload {
  event?: string;
  data?: { id?: number | string; reference?: string; [key: string]: unknown };
}

export type IngestResult = 'queued' | 'duplicate';

/**
 * Webhook ingest: the synchronous, fast part of webhook handling.
 *
 * 1. Verify the signature. Nothing unsigned is stored or processed.
 * 2. Store the raw event. externalEventId is unique in the DB, so a
 *    duplicate delivery (Paystack retries anything not 200'd quickly)
 *    can't create a second row, even when two copies arrive concurrently.
 * 3. Enqueue processing and return. Ledger work happens in the worker.
 *
 * If enqueueing fails, the error propagates as a 5xx so Paystack retries;
 * the retry hits the duplicate path, which re-enqueues any event not yet
 * COMPLETED. An event is never stored-but-forgotten.
 *
 * With REDIS_ENABLED=false there is no queue and no worker, so step 3 runs
 * the handler inline instead. That costs the caller one provider
 * verification round-trip before the ack, but the alternative — storing the
 * event and having nothing ever process it — means payments silently never
 * settle.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  private readonly queueEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @InjectQueue(WEBHOOKS_QUEUE) private readonly webhookQueue: Queue<WebhookJobData>,
    private readonly handler: WebhookEventHandler,
    configService: ConfigService,
  ) {
    this.queueEnabled = configService.get<boolean>('redis.enabled') ?? true;
  }

  async ingest(
    rawBody: Buffer,
    signature: string | undefined,
    payload: PaystackWebhookPayload,
  ): Promise<IngestResult> {
    if (!signature || !this.paymentProvider.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected webhook with invalid or missing signature', {
        provider: this.paymentProvider.name,
        eventType: typeof payload?.event === 'string' ? payload.event : undefined,
      });
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const eventType = payload?.event;
    const eventKey = payload?.data?.id ?? payload?.data?.reference;
    if (typeof eventType !== 'string' || eventKey === undefined || eventKey === null) {
      throw new BadRequestException('Webhook payload missing event type or data identifier');
    }

    // Paystack payloads carry no top-level event id. The same event for the
    // same object (e.g. charge.success for transaction 302961) is the unit
    // of deduplication; a later transfer.reversed for a transfer that
    // earlier sent transfer.success is a distinct event.
    const externalEventId = `${this.paymentProvider.name}:${eventType}:${eventKey}`;

    let event: WebhookEvent;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          provider: this.paymentProvider.name,
          eventType,
          externalEventId,
          signature,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { externalEventId },
      });
      this.logger.log('Duplicate webhook ignored', {
        externalEventId,
        processingStatus: existing.processingStatus,
      });
      if (existing.processingStatus !== 'COMPLETED') {
        await this.enqueue(existing.id);
      }
      return 'duplicate';
    }

    await this.enqueue(event.id);
    this.logger.log('Webhook stored and queued', { webhookEventId: event.id, externalEventId });
    return 'queued';
  }

  /**
   * Hand the stored event to the worker — or, with no worker to hand it to,
   * process it here. Either way this either succeeds or throws, and a throw
   * becomes a 5xx that makes the provider retry.
   */
  private async enqueue(webhookEventId: string): Promise<void> {
    if (!this.queueEnabled) {
      await this.handler.handle(webhookEventId);
      return;
    }

    await withTimeout(
      this.webhookQueue.add(
        'process-webhook',
        { webhookEventId },
        {
          jobId: `webhook:${webhookEventId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: { age: 604800 },
        },
      ),
      ENQUEUE_TIMEOUT_MS,
    );
  }
}
