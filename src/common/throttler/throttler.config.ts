import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { AUTH_RATE_LIMIT_KEY } from './auth-rate-limit.decorator';

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

// Reflector is a stateless wrapper over Reflect.getMetadata, so it is safe
// to build one here rather than inject it — this runs before the DI
// container exists.
const reflector = new Reflector();

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
        // Opt-in, via @AuthRateLimit(). A registered throttler otherwise
        // applies to every route: with the auth limit always on, /health
        // returned 429 to the platform's own probes after five checks, and
        // a venue full of guests behind one NAT address could manage five
        // QR scans a minute between them. See the decorator for the full
        // reasoning.
        skipIf: (context: ExecutionContext) =>
          !reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [
            context.getHandler(),
            context.getClass(),
          ]),
      },
    ],
  };
}
