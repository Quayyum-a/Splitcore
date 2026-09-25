import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackPayoutProvider } from '../payments/providers/paystack-payout.provider';
import { LedgerAccountType } from '@prisma/client';
import { nanoid } from 'nanoid';

/**
 * Payouts Service
 *
 * Handles payout creation and processing with these guarantees:
 * 1. Idempotency (same ledger entry won't trigger duplicate payouts)
 * 2. KYC gating (only VERIFIED entertainers get payouts)
 * 3. Balance preservation (failed payouts don't lose the liability)
 * 4. Retry support (transient failures can be retried)
 *
 * DESIGN NOTE: Per-tip instant payouts keep transfers <₦10k, avoiding ₦50 stamp duty
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackPayoutProvider: PaystackPayoutProvider,
  ) {}

  /**
   * Create and process payouts for a successful payment
   *
   * Called after ledger entries are written.
   * Creates payout records for entertainer and venue payable accounts.
   *
   * CRITICAL: Only pay out to VERIFIED entertainers (KYC gate)
   * Ledger entries still exist for unverified - money is accounted for, just not transferred
   */
  async createPayoutsForTransaction(transactionId: string): Promise<void> {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { id: transactionId },
      include: {
        ledgerEntries: {
          include: {
            account: true,
          },
        },
        entertainer: true,
        venue: true,
      },
    });

    if (!transaction) {
      this.logger.error('Transaction not found', { transactionId });
      return;
    }

    // Find all payable ledger entries (ENTERTAINER_PAYABLE, VENUE_PAYABLE)
    // These represent money owed to venues and entertainers
    const payableEntries = transaction.ledgerEntries.filter(
      (entry) =>
        entry.direction === 'CREDIT' &&
        (entry.account.type === 'ENTERTAINER_PAYABLE' || entry.account.type === 'VENUE_PAYABLE'),
    );

    this.logger.log('Creating payouts for transaction', {
      transactionId,
      payableEntriesCount: payableEntries.length,
    });

    for (const entry of payableEntries) {
      // Check if payout already exists for this ledger account + transaction (idempotency)
      const existingPayout = await this.prisma.payout.findFirst({
        where: {
          ledgerAccountId: entry.accountId,
          transactionId,
        },
      });

      if (existingPayout) {
        this.logger.log('Payout already exists (idempotency)', {
          payoutId: existingPayout.id,
          ledgerAccountId: entry.accountId,
          transactionId,
        });
        continue;
      }

      // For entertainer payouts, check KYC status
      if (entry.account.type === 'ENTERTAINER_PAYABLE') {
        const entertainer = await this.prisma.entertainer.findUnique({
          where: { id: entry.account.ownerId! },
        });

        if (!entertainer) {
          this.logger.error('Entertainer not found for ledger account', {
            ledgerAccountId: entry.accountId,
            ownerId: entry.account.ownerId,
          });
          continue;
        }

        if (entertainer.kycStatus !== 'VERIFIED') {
          this.logger.log('Entertainer not KYC verified - payout queued but not processed', {
            entertainerId: entertainer.id,
            kycStatus: entertainer.kycStatus,
            amountKobo: entry.amountKobo,
          });

          // Create payout in QUEUED status - will be processed when KYC completes
          await this.prisma.payout.create({
            data: {
              ledgerAccountId: entry.accountId,
              transactionId,
              amountKobo: entry.amountKobo,
              status: 'QUEUED', // Waiting for KYC
            },
          });

          continue;
        }

        // KYC verified - process payout
        await this.processEntertainerPayout(entry.accountId, transactionId, entry.amountKobo);
      } else if (entry.account.type === 'VENUE_PAYABLE') {
        // Venues don't have KYC requirement (business accounts, pre-verified)
        await this.processVenuePayout(entry.accountId, transactionId, entry.amountKobo);
      }
    }
  }

  /**
   * Process entertainer payout
   * Creates recipient (if needed) and initiates transfer
   */
  private async processEntertainerPayout(
    ledgerAccountId: string,
    transactionId: string,
    amountKobo: number,
  ): Promise<void> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { id: ledgerAccountId },
    });

    if (!account || !account.ownerId) {
      this.logger.error('Invalid ledger account', { ledgerAccountId });
      return;
    }

    const entertainer = await this.prisma.entertainer.findUnique({
      where: { id: account.ownerId },
    });

    if (!entertainer) {
      this.logger.error('Entertainer not found', { entertainerId: account.ownerId });
      return;
    }

    // Validate bank details exist
    if (!entertainer.bankName || !entertainer.accountNumber) {
      this.logger.error('Entertainer missing bank details', {
        entertainerId: entertainer.id,
      });

      // Create payout in FAILED status with reason
      await this.prisma.payout.create({
        data: {
          ledgerAccountId,
          transactionId,
          amountKobo,
          status: 'FAILED',
          failureReason: 'Missing bank account details',
          attemptedAt: new Date(),
        },
      });

      return;
    }

    try {
      // Generate unique transfer reference
      const transferReference = `txf_${nanoid(21)}`;

      // Create recipient with Paystack (or reuse if exists)
      // TODO: Cache recipient codes to avoid creating duplicates
      const recipient = await this.paystackPayoutProvider.createRecipient({
        type: 'nuban',
        name: entertainer.legalName,
        accountNumber: entertainer.accountNumber,
        bankCode: this.getBankCode(entertainer.bankName), // Helper to map bank names to codes
        currency: 'NGN',
        metadata: {
          entertainerId: entertainer.id,
          stageName: entertainer.stageName,
        },
      });

      // Create payout record in PROCESSING status
      const payout = await this.prisma.payout.create({
        data: {
          ledgerAccountId,
          transactionId,
          transferReference,
          recipientCode: recipient.recipientCode,
          amountKobo,
          status: 'PROCESSING',
          attemptedAt: new Date(),
        },
      });

      // Initiate transfer with Paystack
      const transfer = await this.paystackPayoutProvider.initiateTransfer({
        amountKobo,
        recipientCode: recipient.recipientCode,
        reference: transferReference,
        reason: `Tip payout - ${entertainer.stageName}`,
        currency: 'NGN',
        metadata: {
          payoutId: payout.id,
          entertainerId: entertainer.id,
          transactionId,
        },
      });

      this.logger.log('Payout initiated', {
        payoutId: payout.id,
        transferReference,
        amountKobo,
        entertainerName: entertainer.stageName,
        transferStatus: transfer.status,
      });

      // Update payout status based on transfer result
      if (transfer.status === 'success') {
        await this.prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: 'SUCCESS',
            completedAt: new Date(),
          },
        });
      } else if (transfer.status === 'failed') {
        await this.prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: 'FAILED',
            failureReason: transfer.failureReason,
          },
        });
      }
      // If 'pending', webhook will update status later
    } catch (error) {
      this.logger.error('Failed to process entertainer payout', {
        ledgerAccountId,
        entertainerId: entertainer.id,
        error: error instanceof Error ? error.message : String(error),
      });

      // Create payout in FAILED status
      await this.prisma.payout.create({
        data: {
          ledgerAccountId,
          transactionId,
          amountKobo,
          status: 'FAILED',
          failureReason: error instanceof Error ? error.message : 'Unknown error',
          attemptedAt: new Date(),
        },
      });
    }
  }

  /**
   * Process venue payout
   * Similar to entertainer payout but no KYC check
   */
  private async processVenuePayout(
    ledgerAccountId: string,
    transactionId: string,
    amountKobo: number,
  ): Promise<void> {
    // TODO: Implement venue payout logic
    // For now, just create a QUEUED payout
    // Venues might have different payout schedule (batch daily vs instant)
    await this.prisma.payout.create({
      data: {
        ledgerAccountId,
        transactionId,
        amountKobo,
        status: 'QUEUED', // Batch processing later
      },
    });

    this.logger.log('Venue payout queued', {
      ledgerAccountId,
      transactionId,
      amountKobo,
    });
  }

  /**
   * Helper: Map bank name to Paystack bank code
   * TODO: Maintain comprehensive mapping of Nigerian banks
   */
  private getBankCode(bankName: string): string {
    const bankCodes: Record<string, string> = {
      GTBank: '058',
      'Access Bank': '044',
      'First Bank': '011',
      UBA: '033',
      'Zenith Bank': '057',
      'Stanbic IBTC': '221',
      'Sterling Bank': '232',
      'Polaris Bank': '076',
      'Wema Bank': '035',
      'Union Bank': '032',
      Ecobank: '050',
      'Fidelity Bank': '070',
      FCMB: '214',
      'Kuda Bank': '090267',
      Opay: '999992',
      // Add more as needed
    };

    const code = bankCodes[bankName];
    if (!code) {
      this.logger.warn('Unknown bank name', { bankName });
      throw new Error(`Unknown bank: ${bankName}`);
    }

    return code;
  }

  /**
   * Update payout status from webhook
   * Called when transfer.success or transfer.failed webhook arrives
   */
  async updatePayoutFromWebhook(
    transferReference: string,
    status: 'success' | 'failed' | 'reversed',
    failureReason?: string,
  ): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { transferReference },
    });

    if (!payout) {
      this.logger.warn('Payout not found for transfer reference', { transferReference });
      return;
    }

    if (status === 'success') {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      });

      this.logger.log('Payout marked as SUCCESS from webhook', {
        payoutId: payout.id,
        transferReference,
      });
    } else if (status === 'failed' || status === 'reversed') {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          failureReason,
        },
      });

      this.logger.log('Payout marked as FAILED from webhook', {
        payoutId: payout.id,
        transferReference,
        failureReason,
      });

      // CRITICAL: Balance is preserved - ledger entry still exists
      // The entertainer's payable account balance reflects what's owed
      // Manual review or retry can be triggered later
    }
  }
}
