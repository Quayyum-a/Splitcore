import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Venue } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KYC_PROVIDER, KycProvider } from '../kyc/interfaces/kyc-provider.interface';
import { AccountResolutionError } from '../kyc/providers/paystack-kyc.provider';
import { BanksService } from '../banks/banks.service';
import { maskAccountNumber, normalizeName } from '../kyc/kyc.service';

export type VenuePayoutAccountStep =
  'BANK_DETAILS' | 'RESOLVE_ACCOUNT' | 'CONFIRM_ACCOUNT' | 'DONE';

export interface VenuePayoutAccountView {
  venueId: string;
  venueName: string;
  nextStep: VenuePayoutAccountStep;
  bankName: string | null;
  bankCode: string | null;
  /** Last four digits only. The full number is never echoed back. */
  accountNumberMasked: string | null;
  resolvedAccountName: string | null;
  accountResolvedAt: Date | null;
  accountConfirmedAt: Date | null;
  /** Whether a VENUE_PAYABLE payout will actually be attempted. */
  payoutsEnabled: boolean;
}

/**
 * A venue's own payout destination.
 *
 * Three steps, the same shape the entertainer flow already proved:
 *
 *   bank details -> resolve account -> confirm holder
 *
 * There is deliberately no identity-verification step. A venue is a business
 * entity vetted when it was onboarded, not an unknown individual, so the question
 * "is this really you?" is already answered; the open question is only "does this
 * account belong to you?", which resolve/confirm answers.
 *
 * Unlike the entertainer case, the venue admin confirming their own venue's
 * account is exactly the right person doing it rather than a bypass - which is
 * why confirmation here is VENUE_ADMIN/PLATFORM_ADMIN and not locked to a third
 * party.
 */
@Injectable()
export class VenuePayoutAccountService {
  private readonly logger = new Logger(VenuePayoutAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
    private readonly banks: BanksService,
  ) {}

  async getStatus(venueId: string): Promise<VenuePayoutAccountView> {
    return this.toView(await this.find(venueId));
  }

  /** Step 1. Changing the account invalidates everything downstream of it. */
  async submitBankDetails(
    venueId: string,
    input: { bankName?: string; bankCode?: string; accountNumber: string },
  ): Promise<VenuePayoutAccountView> {
    await this.find(venueId);

    // Resolved against the provider's live list, so a stored code is always a
    // real bank and a mistyped one is a 400 rather than a misdirected transfer.
    const bank = await this.banks.resolve(input);
    const venue = await this.find(venueId);

    const changed = venue.accountNumber !== input.accountNumber || venue.bankCode !== bank.code;

    const updated = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        bankName: bank.name,
        bankCode: bank.code,
        accountNumber: input.accountNumber,
        // A new destination makes any earlier confirmation meaningless - keeping
        // it would let someone pass the name check on one account and then swap
        // the number underneath it.
        ...(changed
          ? { resolvedAccountName: null, accountResolvedAt: null, accountConfirmedAt: null }
          : {}),
      },
    });

    this.logger.log('Venue bank details captured', { venueId, bankCode: bank.code });
    return this.toView(updated);
  }

  /** Step 2. Ask the bank who owns the account. */
  async resolveAccount(venueId: string): Promise<VenuePayoutAccountView> {
    const venue = await this.find(venueId);

    if (!venue.accountNumber || !venue.bankCode) {
      throw new BadRequestException(
        'Bank details must be submitted before the account can be resolved.',
      );
    }

    try {
      const resolved = await this.provider.resolveAccount(venue.accountNumber, venue.bankCode);

      const updated = await this.prisma.venue.update({
        where: { id: venueId },
        data: {
          resolvedAccountName: resolved.accountName,
          accountResolvedAt: new Date(),
          // Resolving again invalidates a previous confirmation: the name being
          // confirmed must always be the name most recently returned.
          accountConfirmedAt: null,
        },
      });

      this.logger.log('Venue account resolved with the bank', { venueId });
      return this.toView(updated);
    } catch (error) {
      if (error instanceof AccountResolutionError) {
        this.logger.warn('Venue account could not be resolved', { venueId, reason: error.message });
        throw new BadRequestException(`Account could not be resolved: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Step 3. The venue confirms the bank's name for the account.
   *
   * Requires the submitted name to match what was resolved, so a stale screen
   * cannot confirm a name that has since changed.
   */
  async confirmAccount(venueId: string, confirmedName: string): Promise<VenuePayoutAccountView> {
    const venue = await this.find(venueId);

    if (!venue.resolvedAccountName) {
      throw new BadRequestException('The account must be resolved before it can be confirmed.');
    }
    if (normalizeName(confirmedName) !== normalizeName(venue.resolvedAccountName)) {
      throw new BadRequestException(
        'The confirmed name does not match the name the bank returned. Resolve the account again.',
      );
    }

    const updated = await this.prisma.venue.update({
      where: { id: venueId },
      data: { accountConfirmedAt: new Date() },
    });

    this.logger.log('Venue payout account confirmed', { venueId });
    return this.toView(updated);
  }

  private async find(venueId: string): Promise<Venue> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);
    return venue;
  }

  private toView(v: Venue): VenuePayoutAccountView {
    return {
      venueId: v.id,
      venueName: v.name,
      nextStep: nextStepFor(v),
      bankName: v.bankName,
      bankCode: v.bankCode,
      accountNumberMasked: maskAccountNumber(v.accountNumber),
      resolvedAccountName: v.resolvedAccountName,
      accountResolvedAt: v.accountResolvedAt,
      accountConfirmedAt: v.accountConfirmedAt,
      payoutsEnabled: v.accountConfirmedAt !== null,
    };
  }
}

/** Derived, not stored, so a client never has to work it out. */
export function nextStepFor(v: {
  accountNumber: string | null;
  bankCode: string | null;
  resolvedAccountName: string | null;
  accountConfirmedAt: Date | null;
}): VenuePayoutAccountStep {
  if (!v.accountNumber || !v.bankCode) return 'BANK_DETAILS';
  if (!v.resolvedAccountName) return 'RESOLVE_ACCOUNT';
  if (!v.accountConfirmedAt) return 'CONFIRM_ACCOUNT';
  return 'DONE';
}
