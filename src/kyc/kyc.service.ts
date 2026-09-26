import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Entertainer, KycStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  KYC_PROVIDER,
  KycProvider,
  IdentityDocumentType,
} from './interfaces/kyc-provider.interface';
import { AccountResolutionError } from './providers/paystack-kyc.provider';

/** The five steps of the spec's onboarding flow, in order. */
export type KycStep =
  'BANK_DETAILS' | 'RESOLVE_ACCOUNT' | 'CONFIRM_ACCOUNT' | 'VERIFY_IDENTITY' | 'DONE';

export interface KycStatusView {
  entertainerId: string;
  status: KycStatus;
  nextStep: KycStep;
  bankName: string | null;
  bankCode: string | null;
  /** Last 4 digits only. The full number is never echoed back. */
  accountNumberMasked: string | null;
  resolvedAccountName: string | null;
  accountConfirmedAt: Date | null;
  identityCheckType: string | null;
  identityCheckedAt: Date | null;
  failureReason: string | null;
  /** True when payouts will actually be attempted for this entertainer. */
  payoutsEnabled: boolean;
}

/**
 * Entertainer onboarding, exactly the spec's flow:
 *
 *   bank details -> resolve account -> confirm holder -> identity -> VERIFIED
 *
 * The resolve/confirm pair is the fraud-prevention core: the platform asks the
 * bank whose account this is, shows that name back, and only proceeds once the
 * entertainer confirms it. A typed account number is never trusted on its own.
 *
 * Identity numbers (BVN/NIN) are passed to the provider and never persisted.
 * Only the document TYPE and the outcome are stored.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  async getStatus(entertainerId: string): Promise<KycStatusView> {
    return this.toView(await this.find(entertainerId));
  }

  /** Step 1. Capturing details resets any previous verification for this account. */
  async submitBankDetails(
    entertainerId: string,
    input: { bankName: string; bankCode: string; accountNumber: string },
  ): Promise<KycStatusView> {
    const entertainer = await this.find(entertainerId);
    this.assertNotSuspended(entertainer);

    const changed =
      entertainer.accountNumber !== input.accountNumber || entertainer.bankCode !== input.bankCode;

    const updated = await this.prisma.entertainer.update({
      where: { id: entertainerId },
      data: {
        bankName: input.bankName,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        // New destination, so everything downstream of it is stale. Keeping a
        // prior confirmation would let someone swap the account number after
        // the name check had already passed.
        ...(changed
          ? {
              resolvedAccountName: null,
              accountResolvedAt: null,
              accountConfirmedAt: null,
              kycVerifiedAt: null,
              identityCheckType: null,
              identityCheckedAt: null,
              kycFailureReason: null,
            }
          : {}),
        kycStatus: KycStatus.PENDING,
        kycSubmittedAt: new Date(),
      },
    });

    this.logger.log('Bank details captured', { entertainerId, bankCode: input.bankCode });
    return this.toView(updated);
  }

  /** Step 2. Ask the bank who owns the account. */
  async resolveAccount(entertainerId: string): Promise<KycStatusView> {
    const entertainer = await this.find(entertainerId);
    this.assertNotSuspended(entertainer);

    if (!entertainer.accountNumber || !entertainer.bankCode) {
      throw new BadRequestException(
        'Bank details must be submitted before the account can be resolved.',
      );
    }

    try {
      const resolved = await this.provider.resolveAccount(
        entertainer.accountNumber,
        entertainer.bankCode,
      );

      const updated = await this.prisma.entertainer.update({
        where: { id: entertainerId },
        data: {
          resolvedAccountName: resolved.accountName,
          accountResolvedAt: new Date(),
          // Resolving again invalidates a previous confirmation: the name being
          // confirmed must always be the name most recently returned.
          accountConfirmedAt: null,
          kycStatus: KycStatus.PENDING,
          kycFailureReason: null,
        },
      });

      this.logger.log('Account resolved with the bank', { entertainerId });
      return this.toView(updated);
    } catch (error) {
      if (error instanceof AccountResolutionError) {
        const updated = await this.prisma.entertainer.update({
          where: { id: entertainerId },
          data: { kycStatus: KycStatus.FAILED, kycFailureReason: error.message },
        });
        this.logger.warn('Account could not be resolved', { entertainerId, reason: error.message });
        // The bank rejecting the details is the caller's problem to fix, not a
        // server fault.
        throw new BadRequestException({
          message: `Account could not be resolved: ${error.message}`,
          kyc: this.toView(updated),
        });
      }
      throw error;
    }
  }

  /**
   * Step 3. The entertainer confirms the bank's name is theirs.
   *
   * Requires the name they are confirming to match what was resolved, so a
   * stale screen cannot confirm a name that has since changed.
   */
  async confirmAccount(entertainerId: string, confirmedName: string): Promise<KycStatusView> {
    const entertainer = await this.find(entertainerId);
    this.assertNotSuspended(entertainer);

    if (!entertainer.resolvedAccountName) {
      throw new BadRequestException('The account must be resolved before it can be confirmed.');
    }
    if (normalizeName(confirmedName) !== normalizeName(entertainer.resolvedAccountName)) {
      throw new BadRequestException(
        'The confirmed name does not match the name the bank returned. Resolve the account again.',
      );
    }

    const updated = await this.prisma.entertainer.update({
      where: { id: entertainerId },
      data: {
        accountConfirmedAt: new Date(),
        kycStatus: KycStatus.PENDING,
        kycFailureReason: null,
      },
    });

    this.logger.log('Account holder confirmed by entertainer', { entertainerId });
    return this.toView(updated);
  }

  /**
   * Step 4. Identity verification.
   *
   * The document number reaches the provider and nothing else. It is not
   * written to the database, not logged, and not returned.
   */
  async verifyIdentity(
    entertainerId: string,
    input: { documentType: IdentityDocumentType; documentNumber: string },
  ): Promise<KycStatusView> {
    const entertainer = await this.find(entertainerId);
    this.assertNotSuspended(entertainer);

    if (!entertainer.accountConfirmedAt) {
      throw new BadRequestException(
        'The bank account must be confirmed before identity verification.',
      );
    }
    if (entertainer.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException('This entertainer is already verified.');
    }

    const { firstName, lastName } = splitLegalName(entertainer.legalName);
    const result = await this.provider.verifyIdentity({
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      firstName,
      lastName,
      accountNumber: entertainer.accountNumber ?? undefined,
      bankCode: entertainer.bankCode ?? undefined,
    });

    const now = new Date();
    const data =
      result.outcome === 'verified'
        ? {
            kycStatus: KycStatus.VERIFIED,
            kycVerifiedAt: now,
            identityCheckType: input.documentType,
            identityCheckedAt: now,
            kycFailureReason: null,
          }
        : result.outcome === 'failed'
          ? {
              kycStatus: KycStatus.FAILED,
              identityCheckType: input.documentType,
              identityCheckedAt: now,
              kycFailureReason: result.reason ?? 'Identity verification failed.',
            }
          : {
              // The check never ran, so neither VERIFIED nor FAILED is true.
              // REVIEW means a person has to decide, and payouts stay gated
              // meanwhile - the money is accounted for, just not released.
              kycStatus: KycStatus.REVIEW,
              identityCheckType: input.documentType,
              identityCheckedAt: null,
              kycFailureReason: result.reason ?? 'Identity verification could not be completed.',
            };

    const updated = await this.prisma.entertainer.update({ where: { id: entertainerId }, data });

    this.logger.log('Identity check completed', {
      entertainerId,
      documentType: input.documentType,
      outcome: result.outcome,
      resultingStatus: updated.kycStatus,
    });

    return this.toView(updated);
  }

  /**
   * Manual decision for an entertainer sitting in REVIEW - which is where every
   * entertainer lands while the Paystack account lacks the identity tier.
   * PLATFORM_ADMIN only, enforced at the controller.
   */
  async decideReview(
    entertainerId: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
    adminUserId: string,
  ): Promise<KycStatusView> {
    const entertainer = await this.find(entertainerId);

    if (entertainer.kycStatus !== KycStatus.REVIEW) {
      throw new ConflictException(
        `Entertainer is ${entertainer.kycStatus}; only REVIEW can be decided manually.`,
      );
    }
    if (decision === 'APPROVE' && !entertainer.accountConfirmedAt) {
      // Approving an unconfirmed destination would send money to an account
      // nobody checked belonged to them.
      throw new BadRequestException(
        'Cannot approve: the bank account has not been resolved and confirmed.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.entertainer.update({
      where: { id: entertainerId },
      data:
        decision === 'APPROVE'
          ? {
              kycStatus: KycStatus.VERIFIED,
              kycVerifiedAt: now,
              kycFailureReason: `Manually approved: ${reason}`,
            }
          : { kycStatus: KycStatus.FAILED, kycFailureReason: `Manually rejected: ${reason}` },
    });

    this.logger.warn('KYC decided manually by a platform admin', {
      entertainerId,
      decision,
      adminUserId,
      reason,
    });

    return this.toView(updated);
  }

  private async find(entertainerId: string): Promise<Entertainer> {
    const entertainer = await this.prisma.entertainer.findUnique({ where: { id: entertainerId } });
    if (!entertainer) throw new NotFoundException(`Entertainer ${entertainerId} not found`);
    return entertainer;
  }

  private assertNotSuspended(entertainer: Entertainer): void {
    if (entertainer.kycStatus === KycStatus.SUSPENDED) {
      throw new ConflictException(
        'This entertainer is suspended. A platform admin must lift the suspension first.',
      );
    }
  }

  private toView(e: Entertainer): KycStatusView {
    return {
      entertainerId: e.id,
      status: e.kycStatus,
      nextStep: nextStepFor(e),
      bankName: e.bankName,
      bankCode: e.bankCode,
      accountNumberMasked: maskAccountNumber(e.accountNumber),
      resolvedAccountName: e.resolvedAccountName,
      accountConfirmedAt: e.accountConfirmedAt,
      identityCheckType: e.identityCheckType,
      identityCheckedAt: e.identityCheckedAt,
      failureReason: e.kycFailureReason,
      // The single question a payout cares about.
      payoutsEnabled: e.kycStatus === KycStatus.VERIFIED && e.accountConfirmedAt !== null,
    };
  }
}

/** Where the entertainer is in the flow, derived rather than stored. */
export function nextStepFor(e: {
  kycStatus: KycStatus;
  accountNumber: string | null;
  bankCode: string | null;
  resolvedAccountName: string | null;
  accountConfirmedAt: Date | null;
}): KycStep {
  if (e.kycStatus === KycStatus.VERIFIED) return 'DONE';
  if (!e.accountNumber || !e.bankCode) return 'BANK_DETAILS';
  if (!e.resolvedAccountName) return 'RESOLVE_ACCOUNT';
  if (!e.accountConfirmedAt) return 'CONFIRM_ACCOUNT';
  return 'VERIFY_IDENTITY';
}

/** Never echo a full account number back to a caller. */
export function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  const last4 = accountNumber.slice(-4);
  return `${'*'.repeat(Math.max(0, accountNumber.length - 4))}${last4}`;
}

/** Compared case- and spacing-insensitively; banks are inconsistent about both. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Providers want first/last name separately but the domain stores one legal
 * name. First token is the first name, the remainder is the surname.
 */
export function splitLegalName(legalName: string): { firstName: string; lastName: string } {
  const parts = legalName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
