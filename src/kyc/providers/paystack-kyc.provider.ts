import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityCheckResult,
  IdentityDocumentType,
  KycProvider,
  ResolvedAccount,
} from '../interfaces/kyc-provider.interface';

/**
 * Paystack implementation of KycProvider.
 *
 * Account resolution (`GET /bank/resolve`) is available on every tier and works
 * today. Identity verification is not: Paystack gates the identity APIs behind
 * the CAC-registered "Registered Business" tier and answers 404 on accounts
 * without it. Probed against the live account on 2026-09-26 - all of
 * /identity/bvn/match, /bank/resolve_bvn/:bvn and /customer/identification
 * returned 404, so this returns `unavailable` rather than pretending.
 */
@Injectable()
export class PaystackKycProvider implements KycProvider {
  readonly name = 'paystack';
  private readonly logger = new Logger(PaystackKycProvider.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(configService: ConfigService) {
    this.secretKey = configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    if (!this.secretKey) {
      this.logger.warn('Paystack secret key not configured; KYC verification will not work.');
    }
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
    const url =
      `${this.baseUrl}/bank/resolve` +
      `?account_number=${encodeURIComponent(accountNumber)}` +
      `&bank_code=${encodeURIComponent(bankCode)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    const body = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: { account_number?: string; account_name?: string };
    } | null;

    if (!response.ok || !body?.status || !body.data?.account_name) {
      // The provider's own message is the useful part here ("Cannot resolve
      // account", "Invalid bank code"), so it is surfaced rather than replaced.
      const message = body?.message ?? response.statusText;
      this.logger.warn('Account resolution failed', { bankCode, status: response.status, message });
      throw new AccountResolutionError(message);
    }

    return {
      accountNumber: body.data.account_number ?? accountNumber,
      bankCode,
      accountName: body.data.account_name,
    };
  }

  /**
   * The document number is forwarded and never stored or logged here. Nothing
   * in this method writes it anywhere, which is the point: the only durable
   * record of an identity check is its type and its outcome.
   */
  async verifyIdentity(params: {
    documentType: IdentityDocumentType;
    documentNumber: string;
    firstName: string;
    lastName: string;
    accountNumber?: string;
    bankCode?: string;
  }): Promise<IdentityCheckResult> {
    const url = `${this.baseUrl}/identity/bvn/match`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bvn: params.documentNumber,
          account_number: params.accountNumber,
          bank_code: params.bankCode,
          first_name: params.firstName,
          last_name: params.lastName,
        }),
      });
    } catch (error) {
      // A network failure is not a failed identity check. Saying "failed" here
      // would put a legitimate entertainer into a FAILED state for an outage.
      this.logger.error('Identity verification request could not be sent', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        outcome: 'unavailable',
        reason: 'The identity verification provider could not be reached.',
      };
    }

    if (response.status === 404) {
      this.logger.warn(
        'Paystack identity verification is not enabled for this account (404). ' +
          'It requires the CAC-registered "Registered Business" tier.',
      );
      return {
        outcome: 'unavailable',
        reason:
          'Identity verification is not enabled on the connected Paystack account. It requires ' +
          'the CAC-registered "Registered Business" tier with identity verification completed.',
      };
    }

    const body = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        is_blacklisted?: boolean;
        account_number?: boolean;
        first_name?: boolean;
        last_name?: boolean;
      };
    } | null;

    if (!response.ok || !body?.status) {
      return { outcome: 'failed', reason: body?.message ?? response.statusText };
    }

    // Paystack answers with per-field booleans rather than a single verdict.
    const matched = body.data?.first_name === true && body.data?.last_name === true;
    if (!matched) {
      return {
        outcome: 'failed',
        reason: 'The name on the identity document does not match the name provided.',
      };
    }
    if (body.data?.is_blacklisted === true) {
      return { outcome: 'failed', reason: 'The identity document is blacklisted.' };
    }

    return { outcome: 'verified' };
  }
}

/** Distinguishes "the bank said no" from a bug, so the service can answer 400. */
export class AccountResolutionError extends Error {}
