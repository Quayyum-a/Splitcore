/**
 * Bank name -> Paystack bank code, for the bank names Phase 2 stores on
 * Entertainer.bankName.
 *
 * Kept, not retired, now that BanksService holds the provider's live list. It has
 * two jobs that the live list cannot do on its own:
 *
 *  1. An ALIAS MAP. Paystack calls these banks "Guaranty Trust Bank", "United
 *     Bank For Africa" and "First City Monument Bank"; everyone in Nigeria says
 *     GTBank, UBA and FCMB. Without this, the obvious input is a 400.
 *  2. A cold-start fallback, so onboarding still works when the provider is
 *     unreachable and nothing has been cached yet.
 *
 * Unknown names still return undefined rather than guessing, and a payout for an
 * entertainer whose bank cannot be resolved goes to manual review.
 */
const PAYSTACK_BANK_CODES: Record<string, string> = {
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
};

export function resolveBankCode(bankName: string): string | undefined {
  return PAYSTACK_BANK_CODES[bankName];
}
