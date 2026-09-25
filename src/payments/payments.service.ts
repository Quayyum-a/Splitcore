import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { SplitRulesService } from '../split-rules/split-rules.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './interfaces';
import { PaymentSettlementService } from './payment-settlement.service';
import { InitializePaymentDto, PaymentInitResponseDto, PaymentStatusResponseDto } from './dto';

/**
 * Payments Service
 *
 * 1. We generate externalReference ourselves; the DB unique index rejects reuse.
 * 2. A client redirect back from checkout proves nothing. SUCCESS is only
 *    ever set by PaymentSettlementService after verifying with the provider.
 * 3. No active split rule for the venue = no payment. The rule in force at
 *    initialization is snapshotted onto the payment and used at settlement.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly callbackUrl: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly splitRules: SplitRulesService,
    private readonly settlement: PaymentSettlementService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    configService: ConfigService,
  ) {
    // Where the provider sends the guest after checkout: the frontend's
    // "confirming your payment" page, which polls GET /payments/:ref/status.
    // Unset = the callback configured in the provider dashboard is used.
    this.callbackUrl = configService.get<string>('PAYMENT_CALLBACK_URL') || undefined;
  }

  async initializePayment(dto: InitializePaymentDto): Promise<PaymentInitResponseDto> {
    const guestSession = await this.prisma.guestSession.findUnique({
      where: { id: dto.sessionId },
      include: { qrCode: { include: { venue: true, entertainer: true } } },
    });

    if (!guestSession) {
      throw new NotFoundException('Guest session not found');
    }
    if (new Date() > guestSession.expiresAt) {
      throw new GoneException('Guest session has expired');
    }
    const { qrCode } = guestSession;
    if (!qrCode.isActive || qrCode.deactivatedAt) {
      throw new GoneException('QR code is no longer active');
    }
    if (!qrCode.venue.isActive) {
      throw new GoneException('Venue is no longer active');
    }
    if (qrCode.entertainer && !qrCode.entertainer.isActive) {
      throw new GoneException('Entertainer is no longer active');
    }

    // Hard failure: never accept money we don't yet know how to divide.
    const splitRule = await this.splitRules.findActiveByVenue(qrCode.venueId).catch((error) => {
      if (error instanceof NotFoundException) {
        this.logger.error('Payment initialization blocked: no active split rule', {
          venueId: qrCode.venueId,
        });
        throw new BadRequestException(
          'Payment cannot be processed: venue split configuration is not set up. Please contact venue staff.',
        );
      }
      throw error;
    });

    const externalReference = `pay_${nanoid(21)}`;

    const paymentTransaction = await this.prisma.paymentTransaction.create({
      data: {
        externalReference,
        provider: this.paymentProvider.name,
        venueId: qrCode.venueId,
        entertainerId: qrCode.entertainerId,
        guestSessionId: dto.sessionId,
        grossAmountKobo: dto.amountKobo,
        guestDisplayName: dto.guestDisplayName,
        displayNameEnabled: dto.displayNameEnabled ?? false,
        splitRuleId: splitRule.id,
        status: 'CREATED',
      },
    });

    this.logger.log('Payment transaction created', {
      transactionId: paymentTransaction.id,
      reference: externalReference,
      amountKobo: dto.amountKobo,
      venueId: qrCode.venueId,
      entertainerId: qrCode.entertainerId,
      splitRuleId: splitRule.id,
    });

    try {
      const init = await this.paymentProvider.initializePayment({
        reference: externalReference,
        amountKobo: dto.amountKobo,
        email: dto.email,
        callbackUrl: this.buildCallbackUrl(externalReference),
        metadata: {
          transactionId: paymentTransaction.id,
          venueId: qrCode.venueId,
          entertainerId: qrCode.entertainerId,
        },
      });

      return {
        transactionId: paymentTransaction.id,
        reference: externalReference,
        authorizationUrl: init.authorizationUrl,
        accessCode: init.accessCode,
        amountKobo: dto.amountKobo,
        status: paymentTransaction.status,
      };
    } catch (error) {
      this.logger.error('Failed to initialize provider checkout', {
        transactionId: paymentTransaction.id,
        reference: externalReference,
        error: error instanceof Error ? error.message : String(error),
      });

      // The guest never received a checkout URL, so no money can have moved.
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
   * Adds the reference to the configured callback URL, preserving any query
   * string it already carries. Paystack appends its own `reference` and
   * `trxref` on top, so the handler on the other end has to tolerate a
   * repeated parameter either way.
   */
  private buildCallbackUrl(reference: string): string | undefined {
    if (!this.callbackUrl) return undefined;

    try {
      const url = new URL(this.callbackUrl);
      url.searchParams.set('reference', reference);
      return url.toString();
    } catch {
      this.logger.warn(
        'PAYMENT_CALLBACK_URL is not a valid URL; falling back to the provider default',
        {
          callbackUrl: this.callbackUrl,
        },
      );
      return undefined;
    }
  }

  /**
   * Guest-facing status. While the payment is unconfirmed this runs the same
   * settlement path the webhook does (verify with the provider, then post
   * the ledger), so a delayed webhook shows as PENDING, never as a
   * frontend-only success.
   */
  async getPaymentStatus(reference: string): Promise<PaymentStatusResponseDto> {
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { externalReference: reference },
      select: { status: true },
    });

    if (!existing) {
      throw new NotFoundException('Payment not found');
    }

    if (existing.status === 'CREATED' || existing.status === 'PENDING') {
      try {
        await this.settlement.settle(reference);
      } catch (error) {
        // Report the stored status; the webhook path will retry settlement.
        this.logger.error('Fallback settlement failed', {
          reference,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const payment = await this.prisma.paymentTransaction.findUniqueOrThrow({
      where: { externalReference: reference },
      include: { venue: true, entertainer: true },
    });

    return {
      transactionId: payment.id,
      reference: payment.externalReference,
      status: payment.status,
      amountKobo: payment.grossAmountKobo,
      venueName: payment.venue.name,
      entertainerName: payment.entertainer?.stageName ?? null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
