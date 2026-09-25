import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';

/**
 * Webhooks Service
 *
 * Handles webhook event processing with these guarantees:
 * 1. Signature verification (reject bad signatures immediately)
 * 2. Unconditional storage (even if duplicate)
 * 3. Idempotency (duplicate events are no-ops)
 * 4. Fast acknowledgment (< 2 seconds)
 * 5. Async processing (BullMQ queue)
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    @InjectQueue('webhooks') private readonly webhookQueue: Queue,
  ) {}

  /**
   * Handle Paystack webhook
   *
   * Flow:
   * 1. Verify signature (REJECT if invalid)
   * 2. Store raw event (ALWAYS, even duplicates)
   * 3. Check if already processed (idempotency)
   * 4. Queue for async processing if new
   * 5. Return 200 to Paystack (fast!)
   */
  async handlePaystackWebhook(rawBody: Buffer, signature: string, payload: any): Promise<void> {
    // STEP 1: Verify signature
    const isValid = this.paystackProvider.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      this.logger.error('Invalid webhook signature', {
        eventType: payload?.event,
        payloadPreview: JSON.stringify(payload).substring(0, 100),
      });
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log('Webhook signature verified', {
      eventType: payload?.event,
      eventId: payload?.id,
    });

    // Extract event ID from payload
    const externalEventId = payload?.id?.toString() || payload?.event_id?.toString();

    if (!externalEventId) {
      this.logger.error('No event ID in webhook payload', {
        payload: JSON.stringify(payload).substring(0, 200),
      });
      throw new BadRequestException('Webhook payload missing event ID');
    }

    // STEP 2: Check for duplicate (idempotency)
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { externalEventId },
    });

    if (existingEvent) {
      this.logger.log('Duplicate webhook event received (idempotency)', {
        externalEventId,
        eventType: payload?.event,
        originalReceivedAt: existingEvent.receivedAt,
        processingStatus: existingEvent.processingStatus,
      });

      // Duplicate is a no-op, but still return success to Paystack
      return;
    }

    // STEP 3: Store raw event
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        provider: 'paystack',
        eventType: payload?.event || 'unknown',
        externalEventId,
        signature,
        payload,
        processingStatus: 'PENDING',
      },
    });

    this.logger.log('Webhook event stored', {
      webhookEventId: webhookEvent.id,
      externalEventId,
      eventType: webhookEvent.eventType,
    });

    // STEP 4: Queue for async processing
    await this.webhookQueue.add(
      'process-webhook',
      {
        webhookEventId: webhookEvent.id,
        provider: 'paystack',
        eventType: webhookEvent.eventType,
        externalEventId,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2s, then 4s, then 8s
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    );

    this.logger.log('Webhook event queued for processing', {
      webhookEventId: webhookEvent.id,
      externalEventId,
    });
  }
}
