import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Only initialize Sentry if DSN is provided
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: NODE_ENV,

    // Performance monitoring sample rate
    // 1.0 = 100% of transactions, 0.1 = 10% of transactions
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,

    // Profiling sample rate
    profilesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,

    integrations: [nodeProfilingIntegration()],

    // Filter sensitive data
    beforeSend(event, hint) {
      // Remove sensitive fields from event data
      if (event.request) {
        // Redact Authorization header
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['Authorization'];
        }

        // Redact sensitive body fields
        if (event.request.data) {
          const data =
            typeof event.request.data === 'string'
              ? JSON.parse(event.request.data)
              : event.request.data;

          if (data.password) data.password = '[REDACTED]';
          if (data.passwordHash) data.passwordHash = '[REDACTED]';
          if (data.token) data.token = '[REDACTED]';

          event.request.data = data;
        }
      }

      // Redact user sensitive fields
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }

      return event;
    },

    // Ignore expected errors
    ignoreErrors: ['UnauthorizedException', 'ForbiddenException', 'NotFoundException'],
  });
}
