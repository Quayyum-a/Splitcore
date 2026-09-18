import { ThrottlerModuleOptions } from '@nestjs/throttler';

export interface ThrottlerConfig {
  default: {
    ttl: number; // Time window in milliseconds
    limit: number; // Max requests per window
  };
  auth: {
    ttl: number;
    limit: number;
  };
}

export const throttlerConfig: ThrottlerConfig = {
  // General endpoints: 100 requests per 60 seconds per IP
  default: {
    ttl: 60000,
    limit: 100,
  },
  // Authentication endpoints: 5 requests per 60 seconds per IP
  auth: {
    ttl: 60000,
    limit: 5,
  },
};

export function getThrottlerModuleOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: throttlerConfig.default.ttl,
        limit: throttlerConfig.default.limit,
      },
      {
        name: 'auth',
        ttl: throttlerConfig.auth.ttl,
        limit: throttlerConfig.auth.limit,
      },
    ],
  };
}
