import { Module } from '@nestjs/common';
import { SplitRulesController } from './split-rules.controller';
import { SplitRulesService } from './split-rules.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SplitRulesController],
  providers: [SplitRulesService],
  exports: [SplitRulesService],
})
export class SplitRulesModule {}
