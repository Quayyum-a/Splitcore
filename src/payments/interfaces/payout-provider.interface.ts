/**
 * Payout Provider Interface
 *
 * Abstraction for payout/transfer processors (Paystack Transfers, Flutterwave, etc.)
 * Handles disbursement of funds to bank accounts.
 */

export interface RecipientParams {
  /**
   * Recipient type: "nuban" for Nigerian bank accounts
   */
  type: 'nuban';

  /**
   * Recipient's full name (must match bank account)
   */
  name: string;

  /**
   * Bank account number
   */
  accountNumber: string;

  /**
   * Nigerian bank code (e.g., "058" for GTBank)
   */
  bankCode: string;

  /**
   * Currency (NGN for naira)
   */
  currency: 'NGN';

  /**
   * Optional metadata
   */
  metadata?: Record<string, any>;
}

export interface Recipient {
  /**
   * Provider's recipient ID (for future transfers)
   */
  recipientCode: string;

  /**
   * Whether recipient is active
   */
  active: boolean;

  /**
   * Raw provider response
   */
  raw?: any;
}

export interface TransferParams {
  /**
   * Amount in kobo (₦1 = 100 kobo)
   * Always integer, never float
   *
   * NOTE: Transfers ≥₦10,000 incur ₦50 stamp duty
   * Our per-tip instant payout design stays under threshold
   */
  amountKobo: number;

  /**
   * Recipient code from createRecipient
   */
  recipientCode: string;

  /**
   * Unique transfer reference (idempotency key)
   * If retried with same reference, provider should not duplicate
   */
  reference: string;

  /**
   * Reason for transfer (shown to recipient)
   */
  reason?: string;

  /**
   * Currency (NGN for naira)
   */
  currency: 'NGN';

  /**
   * Optional metadata
   */
  metadata?: Record<string, any>;
}

export interface Transfer {
  /**
   * Transfer reference
   */
  reference: string;

  /**
   * Transfer status
   */
  status: 'pending' | 'success' | 'failed' | 'reversed';

  /**
   * Amount transferred in kobo
   */
  amountKobo: number;

  /**
   * Provider's transfer ID
   */
  providerTransferId?: string;

  /**
   * When the transfer was initiated
   */
  createdAt: Date;

  /**
   * Failure reason if status is 'failed'
   */
  failureReason?: string;

  /**
   * Raw provider response
   */
  raw?: any;
}

export interface TransferVerification {
  /**
   * Transfer reference
   */
  reference: string;

  /**
   * Current transfer status
   */
  status: 'pending' | 'success' | 'failed' | 'reversed' | 'not_found';

  /**
   * Amount transferred in kobo
   */
  amountKobo: number;

  /**
   * When the transfer was completed
   */
  completedAt?: Date;

  /**
   * Failure reason if status is 'failed'
   */
  failureReason?: string;

  /**
   * Raw provider response
   */
  raw?: any;
}

/**
 * Payout Provider Interface
 *
 * All payout processors must implement this interface.
 * First implementation: PaystackPayoutProvider
 */
/**
 * DI token for the active PayoutProvider.
 */
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

export interface PayoutProvider {
  readonly name: string;

  /**
   * Available balance (kobo) in the account transfers are paid from.
   * Used by reconciliation only.
   */
  getBalance(): Promise<number>;

  /**
   * Create a transfer recipient
   * This registers a bank account with the provider
   *
   * MUST be called before initiating transfer
   */
  createRecipient(params: RecipientParams): Promise<Recipient>;

  /**
   * Initiate a transfer to a recipient
   * This moves money from our balance to their bank account
   *
   * MUST be idempotent - same reference should not create duplicate transfers
   */
  initiateTransfer(params: TransferParams): Promise<Transfer>;

  /**
   * Verify a transfer's status
   * Use this to check if a pending transfer has completed
   */
  verifyTransfer(reference: string): Promise<TransferVerification>;
}
