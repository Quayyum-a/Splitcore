import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardService } from './dashboard.service';
import { EntertainerDashboardController, VenueDashboardController } from './dashboard.controller';

@Module({
  imports: [PrismaModule],
  controllers: [VenueDashboardController, EntertainerDashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
