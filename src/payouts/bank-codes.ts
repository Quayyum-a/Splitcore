/**
 * Bank name -> Paystack bank code, for the bank names Phase 2 stores on
 * Entertainer.bankName.
 *
 * Interim: KYC/onboarding (Phase 6) should store the provider bank code
 * directly, resolved from the provider's bank list, instead of a free-text
 * name. Unknown names return undefined and the payout goes to manual review
 * rather than guessing.
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
