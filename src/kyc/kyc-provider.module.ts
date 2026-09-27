import { Module } from '@nestjs/common';
import { KYC_PROVIDER } from './interfaces/kyc-provider.interface';
import { PaystackKycProvider } from './providers/paystack-kyc.provider';

/**
 * The provider on its own, so both KycModule and BanksModule can depend on it
 * without either depending on the other - BanksService needs the bank list, and
 * KycService needs BanksService to resolve a bank code, which would otherwise be
 * a cycle.
 */
@Module({
  providers: [{ provide: KYC_PROVIDER, useClass: PaystackKycProvider }],
  exports: [KYC_PROVIDER],
})
export class KycProviderModule {}
