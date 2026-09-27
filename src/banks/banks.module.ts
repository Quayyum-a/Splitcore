import { Module } from '@nestjs/common';
import { KycProviderModule } from '../kyc/kyc-provider.module';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  imports: [KycProviderModule],
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
