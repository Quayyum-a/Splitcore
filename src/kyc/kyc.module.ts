import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KYC_PROVIDER } from './interfaces/kyc-provider.interface';
import { PaystackKycProvider } from './providers/paystack-kyc.provider';

@Module({
  imports: [PrismaModule],
  controllers: [KycController],
  providers: [
    KycService,
    // Behind the KycProvider interface, so a second provider can be added
    // without the onboarding flow knowing about it.
    { provide: KYC_PROVIDER, useClass: PaystackKycProvider },
  ],
  exports: [KycService],
})
export class KycModule {}
