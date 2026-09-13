import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global because nearly every domain module from Phase 2 onward will need
// database access — repeating this import everywhere would be pure noise.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
