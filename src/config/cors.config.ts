import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS configuration, resolved per environment.
 *
 * - development: localhost:3000, localhost:3001
 * - test: localhost:3000
 * - production: the canonical domains, the deployed frontend, plus anything
 *   listed in ALLOWED_ORIGINS (comma-separated)
 */

// Browsers send an Origin with no trailing slash, but it is an easy thing to
// paste into an env var, so normalize both sides before comparing.
function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function extraOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(normalize)
    .filter((value) => value.length > 0);
}

export function getCorsOptions(nodeEnv: string): CorsOptions {
  const allowedOrigins: Record<string, string[]> = {
    development: ['http://localhost:3000', 'http://localhost:3001'],
    test: ['http://localhost:3000'],
    production: [
      'https://splitcore.app',
      'https://www.splitcore.app',
      // The deployed guest/dashboard frontend. Listed here rather than left to
      // ALLOWED_ORIGINS so a redeploy cannot silently lock the live site out.
      'https://splitcore-app.netlify.app',
      ...extraOrigins(),
    ],
  };

  return {
    origin: (origin, callback) => {
      const origins = (allowedOrigins[nodeEnv] ?? allowedOrigins.development).map(normalize);

      // No Origin header at all: curl, server-to-server, Paystack webhooks.
      // CORS is a browser mechanism and has nothing to say about these.
      if (!origin) {
        return callback(null, true);
      }

      // Deny by answering "not allowed" rather than by raising. Passing an
      // Error here makes the cors middleware throw, which the exception filter
      // turns into a 500 — so every request from an unlisted origin looked like
      // a server fault, in the logs and in Sentry, instead of a CORS refusal.
      // Omitting the headers is what actually makes the browser block it.
      callback(null, origins.includes(normalize(origin)));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours in seconds
  };
}
