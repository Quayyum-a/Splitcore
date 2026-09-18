import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

// Wrapping PrismaClient in a Nest-managed service (rather than a bare
// singleton import) means it participates in the module lifecycle: it
// connects on boot, and — critically — disconnects on shutdown, so a
// deploy or restart doesn't leave the process holding stale DB connections.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    const databaseUrl = configService.get<string>('database.url')!;
    const nodeEnv = configService.get<string>('nodeEnv', 'development');

    // Parse DATABASE_URL and add connection pool parameters for production
    let connectionUrl = databaseUrl;
    if (nodeEnv === 'production') {
      const url = new URL(databaseUrl);
      const params = new URLSearchParams(url.search);
      
      // Add production-specific connection pool configuration
      if (!params.has('connection_limit')) {
        params.set('connection_limit', '10');
      }
      if (!params.has('pool_timeout')) {
        params.set('pool_timeout', '20');
      }
      if (!params.has('connect_timeout')) {
        params.set('connect_timeout', '20');
      }
      
      url.search = params.toString();
      connectionUrl = url.toString();
    }

    super({
      datasources: {
        db: {
          url: connectionUrl,
        },
      },
      // Configure log levels based on environment
      log: nodeEnv === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
      
      // Enable slow query detection in production (>1000ms)
      if (this.configService.get('nodeEnv') === 'production') {
        this.$on('query' as never, (e: any) => {
          if (e.duration > 1000) {
            this.logger.warn(`Slow query detected: ${e.duration}ms - ${e.query}`);
          }
        });
      }
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Health check for database connectivity
   * Used by health check endpoint to verify database status
   */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database ping failed', error);
      return false;
    }
  }
}
