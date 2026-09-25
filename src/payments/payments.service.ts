import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackProvider } from './providers/paystack.provider';
import { InitializePaymentDto, PaymentInitResponseDto, PaymentStatusResponseDto } from './dto';
import { nanoid } from 'nanoid';

/**
 * Payments Service
 *
 * Handles payment initialization and status checking.
 * Critical rules:
 * 1. Generate externalReference ourselves (don't rely on provider's reference alone)
 * 2. Never trust client-side redirect as proof of payment
 * 3. Only mark SUCCESS after webhook OR explicit verify call
 * 4. Reject payment if no active split rule exists for venue
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly callbackBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    private readonly configService: ConfigService,
  ) {
    // Base URL for payment callbacks (e.g., https://api.splitcore.app)
    this.callbackBaseUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3000';
  }

  /**
   * Initialize a payment transaction
   *
   * Flow:
   * 1. Validate guest session exists and is active
   * 2. Check venue has active split rule (HARD FAILURE if not - can't divide money we don't know how to split)
   * 3. Create PaymentTransaction in CREATED state
   * 4. Call Paystack to get checkout URL
   * 5. Return checkout URL to redirect guest to
   */
  async initializePayment(dto: InitializePaymentDto): Promise<PaymentInitResponseDto> {
    // Validate guest session
    const guestSession = await this.prisma.guestSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        qrCode: {
          include: {
            venue: true,
            entertainer: true,
          },
        },
      },
    });

    if (!guestSession) {
      throw new NotFoundException('Guest session not found');
    }

    // Check if session has expired
    if (new Date() > guestSession.expiresAt) {
      throw new GoneException('Guest session has expired');
    }

    // Check if QR code is active
    if (!guestSession.qrCode.isActive || guestSession.qrCode.deactivatedAt) {
      throw new GoneException('QR code is no longer active');
    }

    // Check if venue is active
    if (!guestSession.qrCode.venue.isActive) {
      throw new GoneException('Venue is no longer active');
    }

    // Check if entertainer (if any) is active
    if (guestSession.qrCode.entertainer && !guestSession.qrCode.entertainer.isActive) {
      throw new GoneException('Entertainer is no longer active');
    }

    // CRITICAL: Check venue has active split rule
    // A missing split rule is a HARD FAILURE - we cannot accept money we don't know how to divide
    const activeSplitRule = await this.prisma.splitRule.findFirst({
      where: {
        venueId: guestSession.qrCode.venueId,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!activeSplitRule) {
      this.logger.error('Payment initialization blocked: no active split rule', {
        venueId: guestSession.qrCode.venueId,
        venueName: guestSession.qrCode.venue.name,
      });
      throw new BadRequestException(
        'Payment cannot be processed: venue split configuration is not set up. Please contact venue staff.',
      );
    }

    // Generate our own reference (primary defense against double-processing)
    const externalReference = `pay_${nanoid(21)}`;

    // Create payment transaction in CREATED state
    const paymentTransaction = await this.prisma.paymentTransaction.create({
      data: {
        externalReference,
        provider: 'paystack',
        venueId: guestSession.qrCode.venueId,
        entertainerId: guestSession.qrCode.entertainerId,
        guestSessionId: dto.sessionId,
        grossAmountKobo: dto.amountKobo,
        guestDisplayName: dto.guestDisplayName,
        displayNameEnabled: dto.displayNameEnabled ?? false,
        status: 'CREATED',
      },
    });

    this.logger.log('Payment transaction created', {
      transactionId: paymentTransaction.id,
      reference: externalReference,
      amountKobo: dto.amountKobo,
      venueId: guestSession.qrCode.venueId,
      entertainerId: guestSession.qrCode.entertainerId,
    });

    // Initialize payment with Paystack
    try {
      const paystackResult = await this.paystackProvider.initializePayment({
        reference: externalReference,
        amountKobo: dto.amountKobo,
        email: dto.email,
        callbackUrl: `${this.callbackBaseUrl}/payments/callback?reference=${externalReference}`,
        metadata: {
          transactionId: paymentTransaction.id,
          venueId: guestSession.qrCode.venueId,
          entertainerId: guestSession.qrCode.entertainerId,
          venueName: guestSession.qrCode.venue.name,
          entertainerName: guestSession.qrCode.entertainer?.stageName,
        },
      });

      return {
        transactionId: paymentTransaction.id,
        reference: externalReference,
        authorizationUrl: paystackResult.authorizationUrl,
        accessCode: paystackResult.accessCode,
        amountKobo: dto.amountKobo,
        status: paymentTransaction.status,
      };
    } catch (error) {
      this.logger.error('Failed to initialize Paystack payment', {
        transactionId: paymentTransaction.id,
        reference: externalReference,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update transaction status to FAILED
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: { status: 'FAILED' },
      });

      throw new BadRequestException(
        'Failed to initialize payment. Please try again or contact support.',
      );
    }
  }

  /**
   * Get payment status by reference
   *
   * This is the fallback verification when:
   * - Guest returns from Paystack checkout
   * - Webhook hasn't fired yet
   *
   * We explicitly verify with Paystack API (not just checking our DB)
   * NEVER trust client-side redirect alone
   */
  async getPaymentStatus(reference: string): Promise<PaymentStatusResponseDto> {
    // Find payment transaction
    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalReference: reference },
      include: {
        venue: true,
        entertainer: true,
      },
    });

    if (!paymentTransaction) {
      throw new NotFoundException('Payment not found');
    }

    // If status is still CREATED or PENDING, verify with Paystack
    if (paymentTransaction.status === 'CREATED' || paymentTransaction.status === 'PENDING') {
      try {
        const verification = await this.paystackProvider.verifyPayment(reference);

        // Update our status based on Paystack's response
        let newStatus:
          'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REVERSED' | 'REFUNDED' =
          paymentTransaction.status as any;
        if (verification.status === 'success') {
          newStatus = 'SUCCESS';
        } else if (verification.status === 'failed') {
          newStatus = 'FAILED';
        } else if (verification.status === 'abandoned') {
          newStatus = 'ABANDONED';
        } else {
          newStatus = 'PENDING';
        }

        // Only update if status changed
        if (newStatus !== paymentTransaction.status) {
          await this.prisma.paymentTransaction.update({
            where: { id: paymentTransaction.id },
            data: { status: newStatus },
          });

          this.logger.log('Payment status updated via fallback verification', {
            transactionId: paymentTransaction.id,
            reference,
            oldStatus: paymentTransaction.status,
            newStatus,
          });

          paymentTransaction.status = newStatus as any;
        }
      } catch (error) {
        this.logger.error('Failed to verify payment with Paystack', {
          reference,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw - return current status even if verification fails
      }
    }

    return {
      transactionId: paymentTransaction.id,
      reference: paymentTransaction.externalReference,
      status: paymentTransaction.status,
      amountKobo: paymentTransaction.grossAmountKobo,
      venueName: paymentTransaction.venue.name,
      entertainerName: paymentTransaction.entertainer?.stageName ?? null,
      createdAt: paymentTransaction.createdAt,
      updatedAt: paymentTransaction.updatedAt,
    };
  }
}
