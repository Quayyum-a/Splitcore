import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Get CORS configuration options based on environment
 *
 * Environment-specific allowed origins:
 * - development: localhost:3000, localhost:3001
 * - test: localhost:3000
 * - production: from environment variable or default production domains
 */
export function getCorsOptions(nodeEnv: string): CorsOptions {
  const allowedOrigins: Record<string, string[]> = {
    development: ['http://localhost:3000', 'http://localhost:3001'],
    test: ['http://localhost:3000'],
    production: [
      'https://splitcore.app',
      'https://www.splitcore.app',
      // Add additional production domains from environment variable if provided
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
    ],
  };

  return {
    origin: (origin, callback) => {
      const origins = allowedOrigins[nodeEnv] || allowedOrigins.development;

      // Allow requests with no origin (mobile apps, Postman, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      if (origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours in seconds
  };
}
