import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
  // SplitRulesModule needs the fee to validate and stamp proposals.
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
