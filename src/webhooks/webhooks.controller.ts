import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Webhooks Controller
 *
 * Handles incoming webhooks from payment providers (Paystack, etc.)
 *
 * CRITICAL SECURITY:
 * 1. Verify signature BEFORE processing
 * 2. Store raw event unconditionally
 * 3. Check for duplicate (idempotency)
 * 4. Respond 200 within 2 seconds
 * 5. Process async (BullMQ)
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // Don't expose in Swagger (internal endpoint)
  @ApiOperation({
    summary: 'Paystack webhook endpoint',
    description:
      'Receives webhook events from Paystack. ' +
      'Verifies signature, stores event, checks idempotency, queues for async processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook received and queued for processing',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid signature or malformed payload',
  })
  async handlePaystackWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
  ): Promise<{ received: boolean }> {
    this.logger.log('Paystack webhook received', {
      eventType: body?.event,
      hasSignature: !!signature,
    });

    // CRITICAL: Get raw body for signature verification
    // Express with express.raw() middleware provides this
    const rawBody = request.rawBody;

    if (!rawBody) {
      this.logger.error('No raw body available for signature verification');
      throw new BadRequestException('Raw body required for signature verification');
    }

    if (!signature) {
      this.logger.error('No signature header provided');
      throw new BadRequestException('Missing x-paystack-signature header');
    }

    // Verify signature, store event, check idempotency, queue for processing
    // This should complete fast (< 2 seconds) to avoid Paystack retries
    await this.webhooksService.handlePaystackWebhook(rawBody, signature, body);

    return { received: true };
  }
}
