import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PayoutProvider,
  RecipientParams,
  Recipient,
  TransferParams,
  Transfer,
  TransferVerification,
} from '../interfaces';

/**
 * Paystack Payout Provider
 *
 * First implementation of PayoutProvider interface.
 * Handles recipient creation and transfer initiation using Paystack Transfers API.
 *
 * DESIGN NOTE: We collect full amount into our balance, then explicitly transfer
 * per recipient. This gives us instant payouts vs. Paystack's T+1 auto-settlement.
 *
 * COST OPTIMIZATION: Per-tip payouts keep individual transfers <₦10,000,
 * avoiding the ₦50 stamp duty that applies to transfers ≥₦10,000.
 */
@Injectable()
export class PaystackPayoutProvider implements PayoutProvider {
  readonly name = 'paystack';
  private readonly logger = new Logger(PaystackPayoutProvider.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';

    if (!this.secretKey) {
      this.logger.warn('Paystack secret key not configured. Payout features will not work.');
    }
  }

  /**
   * Create a transfer recipient
   * This registers a bank account with Paystack for future transfers
   */
  async createRecipient(params: RecipientParams): Promise<Recipient> {
    const url = `${this.baseUrl}/transferrecipient`;

    const payload = {
      type: params.type,
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency,
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
        this.logger.error('Paystack recipient creation failed', {
          status: response.status,
          error: errorData,
          accountNumber: maskAccountNumber(params.accountNumber),
        });
        throw new Error(
          `Paystack recipient creation failed: ${errorData.message || response.statusText}`,
        );
      }

      const data = await response.json();

      if (!data.status || !data.data) {
        throw new Error('Invalid Paystack recipient response format');
      }

      return {
        recipientCode: data.data.recipient_code,
        active: data.data.active,
        raw: data.data,
      };
    } catch (error) {
      this.logger.error('Failed to create Paystack recipient', {
        error: error instanceof Error ? error.message : String(error),
        accountNumber: maskAccountNumber(params.accountNumber),
      });
      throw error;
    }
  }

  /**
   * Initiate a transfer to a recipient
   * Moves money from our Paystack balance to their bank account
   *
   * IDEMPOTENCY: Paystack de-duplicates by reference automatically
   * Same reference won't create duplicate transfers
   */
  async initiateTransfer(params: TransferParams): Promise<Transfer> {
    const url = `${this.baseUrl}/transfer`;

    const payload = {
      source: 'balance', // Transfer from our main balance
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason || 'Splitcore payout',
      currency: params.currency,
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
        this.logger.error('Paystack transfer initiation failed', {
          status: response.status,
          error: errorData,
          reference: params.reference,
          amountKobo: params.amountKobo,
        });
        throw new Error(`Paystack transfer failed: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();

      if (!data.status || !data.data) {
        throw new Error('Invalid Paystack transfer response format');
      }

      const txn = data.data;

      // Map Paystack status to our standard status
      let status: 'pending' | 'success' | 'failed' | 'reversed';
      switch (txn.status) {
        case 'success':
          status = 'success';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'reversed':
          status = 'reversed';
          break;
        default:
          status = 'pending';
      }

      return {
        reference: txn.reference,
        status,
        amountKobo: txn.amount,
        providerTransferId: txn.id?.toString(),
        createdAt: new Date(txn.createdAt || Date.now()),
        failureReason: txn.status === 'failed' ? txn.failure_reason : undefined,
        raw: txn,
      };
    } catch (error) {
      this.logger.error('Failed to initiate Paystack transfer', {
        error: error instanceof Error ? error.message : String(error),
        reference: params.reference,
        amountKobo: params.amountKobo,
      });
      throw error;
    }
  }

  /**
   * Verify a transfer's current status
   * Use this to check if a pending transfer has completed
   */
  async verifyTransfer(reference: string): Promise<TransferVerification> {
    const url = `${this.baseUrl}/transfer/verify/${reference}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      // A reference Paystack has never seen means the transfer was never
      // created. The payout flow relies on telling that apart from "unknown
      // right now" before it risks a second transfer with a new reference.
      if (response.status === 404) {
        return { reference, status: 'not_found', amountKobo: 0 };
      }

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error('Paystack transfer verification failed', {
          status: response.status,
          error: errorData,
          reference,
        });
        throw new Error(
          `Paystack transfer verification failed: ${errorData.message || response.statusText}`,
        );
      }

      const data = await response.json();

      if (!data.status || !data.data) {
        throw new Error('Invalid Paystack transfer verification response format');
      }

      const txn = data.data;

      // Map Paystack status to our standard status
      let status: 'pending' | 'success' | 'failed' | 'reversed';
      switch (txn.status) {
        case 'success':
          status = 'success';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'reversed':
          status = 'reversed';
          break;
        default:
          status = 'pending';
      }

      return {
        reference: txn.reference,
        status,
        amountKobo: txn.amount,
        completedAt: txn.transferred_at ? new Date(txn.transferred_at) : undefined,
        failureReason: txn.status === 'failed' ? txn.failure_reason : undefined,
        raw: txn,
      };
    } catch (error) {
      this.logger.error('Failed to verify Paystack transfer', {
        error: error instanceof Error ? error.message : String(error),
        reference,
      });
      throw error;
    }
  }

  async getBalance(): Promise<number> {
    const response = await fetch(`${this.baseUrl}/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Paystack balance API failed: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    if (!data.status || !Array.isArray(data.data)) {
      throw new Error('Invalid Paystack balance response format');
    }

    const ngn = data.data.find((b: { currency: string }) => b.currency === 'NGN');
    return ngn?.balance ?? 0;
  }
}

function maskAccountNumber(accountNumber: string): string {
  return accountNumber.length > 4 ? `******${accountNumber.slice(-4)}` : '****';
}
