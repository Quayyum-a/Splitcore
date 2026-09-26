export const KYC_PROVIDER = 'KYC_PROVIDER';

/** What the bank says about an account number, as opposed to what someone typed. */
export interface ResolvedAccount {
  accountNumber: string;
  bankCode: string;
  /** The account holder's name exactly as the bank reports it. */
  accountName: string;
}

export type IdentityDocumentType = 'BVN' | 'NIN';

/**
 * Outcome of an identity check.
 *
 * `unavailable` is a first-class outcome, not an error: Paystack's identity
 * APIs are gated behind the CAC-registered "Registered Business" tier, and an
 * account without it gets 404. Collapsing that into `failed` would tell an
 * entertainer they failed a check that was never run.
 */
export type IdentityOutcome = 'verified' | 'failed' | 'unavailable';

export interface IdentityCheckResult {
  outcome: IdentityOutcome;
  /** Human-readable, and never contains the identity number itself. */
  reason?: string;
}

/**
 * Identity and bank-account verification.
 *
 * Separate from PayoutProvider on purpose: resolving who owns an account is a
 * question asked during onboarding, long before any money moves, and a future
 * provider might do one and not the other.
 */
export interface KycProvider {
  readonly name: string;

  /**
   * Ask the bank who owns this account. The returned name is shown to the
   * entertainer to confirm - the platform never decides on its own that a typed
   * account number belongs to the person who typed it.
   */
  resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount>;

  /**
   * Verify an identity document. The number is passed through to the provider
   * and MUST NOT be persisted or logged by the implementation.
   */
  verifyIdentity(params: {
    documentType: IdentityDocumentType;
    documentNumber: string;
    firstName: string;
    lastName: string;
    accountNumber?: string;
    bankCode?: string;
  }): Promise<IdentityCheckResult>;
}
