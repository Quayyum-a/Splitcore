import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BanksModule } from '../banks/banks.module';
import { KycProviderModule } from '../kyc/kyc-provider.module';
import { VenuePayoutAccountController } from './venue-payout-account.controller';
import { VenuePayoutAccountService } from './venue-payout-account.service';

@Module({
  imports: [PrismaModule, KycProviderModule, BanksModule],
  controllers: [VenuePayoutAccountController],
  providers: [VenuePayoutAccountService],
  exports: [VenuePayoutAccountService],
})
export class VenuePayoutAccountModule {}
