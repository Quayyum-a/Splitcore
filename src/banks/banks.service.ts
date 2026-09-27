import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { KYC_PROVIDER, KycProvider, ProviderBank } from '../kyc/interfaces/kyc-provider.interface';
import { resolveBankCode } from '../payouts/bank-codes';

/** Banks change rarely; a day-old list is fine and Paystack is not a hot path. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Bank {
  name: string;
  code: string;
}

/**
 * The bank list, cached.
 *
 * This exists to delete a real hazard: `bankCode` used to be a hand-typed
 * 3-6 digit string with nothing to check it against, so a transposed digit sent
 * money to a different bank and the only signal was a failed or - worse -
 * succeeded transfer to a stranger. Every code now has to exist in the
 * provider's own list.
 */
@Injectable()
export class BanksService {
  private readonly logger = new Logger(BanksService.name);
  private cache: { banks: Bank[]; fetchedAt: number } | null = null;
  /** Collapses concurrent misses into one upstream request. */
  private inFlight: Promise<Bank[]> | null = null;

  constructor(@Inject(KYC_PROVIDER) private readonly provider: KycProvider) {}

  async list(): Promise<Bank[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.banks;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<Bank[]> {
    try {
      const provided = await this.provider.listBanks();
      // A payout destination has to be somewhere a transfer can actually go, so
      // inactive banks and ones that do not support transfers are filtered out
      // rather than offered and failed later.
      const banks = provided
        .filter((b: ProviderBank) => b.active && b.supportsTransfer && b.code && b.name)
        .map((b) => ({ name: b.name, code: b.code }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (banks.length === 0) {
        throw new Error('provider returned no usable banks');
      }

      this.cache = { banks, fetchedAt: Date.now() };
      this.logger.log('Bank list refreshed', { count: banks.length });
      return banks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Serve a stale list rather than failing onboarding over a provider blip.
      // A day-old bank list is still a correct bank list.
      if (this.cache) {
        this.logger.warn('Bank list refresh failed; serving the cached list', {
          error: message,
          ageMs: Date.now() - this.cache.fetchedAt,
        });
        return this.cache.banks;
      }

      // Cold start with the provider down. The hardcoded map covers the banks
      // that actually appear in this market, which beats refusing to onboard
      // anyone at all. Deliberately NOT cached, so the next call retries.
      this.logger.error('Bank list unavailable and no cache; falling back to the static map', {
        error: message,
      });
      return FALLBACK_BANKS;
    }
  }

  /**
   * Turn what the caller gave us into a definite (name, code) pair.
   *
   * Accepts either a name or a code. A code is the better input - it is what
   * GET /banks returns and it sidesteps ambiguity between similarly named banks -
   * but it is validated against the list rather than trusted, so a typo is a 400
   * instead of a misdirected transfer.
   */
  async resolve(input: { bankName?: string; bankCode?: string }): Promise<Bank> {
    const banks = await this.list();

    if (input.bankCode) {
      const byCode = banks.find((b) => b.code === input.bankCode);
      if (!byCode) {
        throw new BadRequestException(
          `Unknown bank code "${input.bankCode}". Use a code from GET /banks.`,
        );
      }
      return byCode;
    }

    if (!input.bankName) {
      throw new BadRequestException('Either bankName or bankCode is required.');
    }

    const wanted = normalizeBankName(input.bankName);

    const exact = banks.filter((b) => normalizeBankName(b.name) === wanted);
    if (exact.length === 1) return exact[0];

    // Colloquial names before fuzzy matching, because they are deterministic
    // where prefix matching is a guess. This is why bank-codes.ts survives: the
    // provider calls these banks "Guaranty Trust Bank", "United Bank For Africa"
    // and "First City Monument Bank", while every Nigerian says GTBank, UBA and
    // FCMB. Without this layer the obvious input is a 400.
    const aliasCode = resolveBankCode(input.bankName.trim());
    if (aliasCode) {
      const byAlias = banks.find((b) => b.code === aliasCode);
      if (byAlias) return byAlias;
    }

    // Only ever narrows to a single candidate. Two plausible matches is the
    // dangerous case - "First Bank" vs "First Bank MFB" are different
    // destinations - so it asks rather than picking one.
    const partial = banks.filter((b) => {
      const n = normalizeBankName(b.name);
      return n.startsWith(wanted) || wanted.startsWith(n);
    });
    if (partial.length === 1) return partial[0];

    if (partial.length > 1) {
      throw new BadRequestException(
        `"${input.bankName}" matches ${partial.length} banks (${partial
          .slice(0, 5)
          .map((b) => b.name)
          .join(', ')}). Send an exact bankCode from GET /banks instead.`,
      );
    }

    throw new BadRequestException(
      `"${input.bankName}" is not a recognised bank. Pick one from GET /banks.`,
    );
  }
}

/** Case, spacing and punctuation vary constantly between what people type and what banks are called. */
export function normalizeBankName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[.,'()]/g, '')
    .replace(/\bPLC\b|\bLTD\b|\bLIMITED\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cold-start fallback: what to offer when the provider is unreachable and nothing
 * is cached yet. Refusing to onboard anyone at all would be worse.
 *
 * Note bank-codes.ts earns its keep twice over - this list, and the alias lookup
 * in resolve() that maps GTBank/UBA/FCMB onto the formal names the provider uses.
 */
const FALLBACK_BANKS: Bank[] = [
  'GTBank',
  'Access Bank',
  'First Bank',
  'UBA',
  'Zenith Bank',
  'Stanbic IBTC',
  'Sterling Bank',
  'Polaris Bank',
  'Wema Bank',
  'Union Bank',
  'Ecobank',
  'Fidelity Bank',
  'FCMB',
  'Kuda Bank',
  'Opay',
]
  .map((name) => ({ name, code: resolveBankCode(name)! }))
  .filter((b) => Boolean(b.code));
