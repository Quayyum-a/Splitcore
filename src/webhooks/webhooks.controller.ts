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
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { PaystackWebhookPayload, WebhooksService } from './webhooks.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Provider webhooks. Signature check, storage and dedupe happen before the
 * 200; ledger work happens in the worker, so a slow database never makes
 * Paystack think delivery failed and retry into a pile-up.
 *
 * The raw body comes from NestFactory.create(..., { rawBody: true }); the
 * signature must be checked against the exact bytes Paystack sent, not a
 * re-serialized object.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paystack')
  @Public()
  // Paystack retries on any non-2xx, so a 429 here would cause exactly the
  // retry pile-up that acking fast is meant to avoid. Provider callbacks are
  // authenticated by signature, not by request rate.
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handlePaystackWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: PaystackWebhookPayload,
  ): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('Raw body required for signature verification');
    }
    await this.webhooksService.ingest(request.rawBody, signature, body);
    return { received: true };
  }
}
