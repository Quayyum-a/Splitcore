import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BanksModule } from '../banks/banks.module';
import { KycProviderModule } from './kyc-provider.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  // BanksModule resolves a bank name or code against the provider's live list,
  // so onboarding no longer trusts a hand-typed code.
  imports: [PrismaModule, KycProviderModule, BanksModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
