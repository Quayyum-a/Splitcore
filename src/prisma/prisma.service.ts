import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Wrapping PrismaClient in a Nest-managed service (rather than a bare
// singleton import) means it participates in the module lifecycle: it
// connects on boot, and — critically — disconnects on shutdown, so a
// deploy or restart doesn't leave the process holding stale DB connections.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from the database');
  }
}
