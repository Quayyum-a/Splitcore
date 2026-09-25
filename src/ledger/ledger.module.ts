import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Ledger Module
 *
 * Provides double-entry bookkeeping for payment transactions.
 * Enforces immutable, balanced ledger entries.
 */
@Module({
  imports: [PrismaModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
