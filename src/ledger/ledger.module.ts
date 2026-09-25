import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './ledger.repository';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Ledger Module
 *
 * LedgerService: pure double-entry posting logic.
 * LedgerRepository: transactional persistence and balance queries.
 */
@Module({
  imports: [PrismaModule],
  providers: [LedgerService, LedgerRepository],
  exports: [LedgerService, LedgerRepository],
})
export class LedgerModule {}
