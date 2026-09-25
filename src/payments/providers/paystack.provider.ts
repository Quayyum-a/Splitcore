import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  PaymentProvider,
  InitializePaymentParams,
  PaymentInitResult,
  PaymentVerification,
} from '../interfaces';

/**
 * Paystack Payment Provider
 *
 * First implementation of PaymentProvider interface.
 * Handles payment initialization, verification, and webhook signature validation.
 *
 * Uses Paystack's hosted checkout - we never see or store card details.
 */
@Injectable()
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly logger = new Logger(PaystackProvider.name);
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    this.publicKey = this.configService.get<string>('PAYSTACK_PUBLIC_KEY') || '';

    if (!this.secretKey || !this.publicKey) {
      this.logger.warn('Paystack keys not configured. Payment features will not work.');
    }
  }

  /**
   * Initialize a payment with Paystack
   * Returns authorization URL to redirect guest to for checkout
   */
  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const url = `${this.baseUrl}/transaction/initialize`;

    // Paystack expects amount in kobo, which is what we already have
    const payload = {
      email: params.email || 'guest@splitcore.app', // Required by Paystack
      amount: params.amountKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error('Paystack initialization failed', {
          status: response.status,
          error: errorData,
        });
        throw new Error(
          `Paystack initialization failed: ${errorData.message || response.statusText}`,
        );
      }

      const data = await response.json();

      if (!data.status || !data.data) {
        throw new Error('Invalid Paystack response format');
      }

      return {
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
      };
    } catch (error) {
      this.logger.error('Failed to initialize Paystack payment', {
        error: error instanceof Error ? error.message : String(error),
        reference: params.reference,
      });
      throw error;
    }
  }

  /**
   * Verify a payment directly against Paystack's API
   * This is the fallback when webhook hasn't fired yet
   *
   * CRITICAL: This is the source of truth, not client-side redirect
   */
  async verifyPayment(reference: string): Promise<PaymentVerification> {
    const url = `${this.baseUrl}/transaction/verify/${reference}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error('Paystack verification failed', {
          status: response.status,
          error: errorData,
          reference,
        });
        throw new Error(
          `Paystack verification failed: ${errorData.message || response.statusText}`,
        );
      }

      const data = await response.json();

      if (!data.status || !data.data) {
        throw new Error('Invalid Paystack verification response format');
      }

      const txn = data.data;

      // Map Paystack status to our standard status
      let status: 'success' | 'failed' | 'abandoned' | 'pending';
      switch (txn.status) {
        case 'success':
          status = 'success';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'abandoned':
          status = 'abandoned';
          break;
        default:
          status = 'pending';
      }

      return {
        reference: txn.reference,
        status,
        amountKobo: txn.amount, // Paystack returns amount in kobo
        currency: txn.currency,
        feesKobo: typeof txn.fees === 'number' ? txn.fees : undefined,
        providerReference: txn.id?.toString(),
        paidAt: txn.paid_at ? new Date(txn.paid_at) : undefined,
        raw: txn,
      };
    } catch (error) {
      this.logger.error('Failed to verify Paystack payment', {
        error: error instanceof Error ? error.message : String(error),
        reference,
      });
      throw error;
    }
  }

  /**
   * Verify webhook signature using HMAC SHA512
   *
   * CRITICAL: MUST be called before processing any webhook payload
   * Reject any payload with invalid signature - it's not from Paystack
   */
  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    // With an empty key, HMAC(key='') is computable by anyone, so an
    // unconfigured secret must reject everything rather than accept forgeries.
    if (!this.secretKey || !signature) {
      this.logger.error('Rejecting webhook: secret key not configured or signature missing');
      return false;
    }

    try {
      const expected = crypto.createHmac('sha512', this.secretKey).update(payload).digest();
      const received = Buffer.from(signature, 'hex');

      // timingSafeEqual throws on length mismatch, and a hex decode of a
      // malformed header can yield a short buffer, so compare lengths first.
      const isValid =
        received.length === expected.length && crypto.timingSafeEqual(expected, received);

      if (!isValid) {
        this.logger.warn('Invalid webhook signature detected');
      }

      return isValid;
    } catch (error) {
      this.logger.error('Failed to verify webhook signature', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
