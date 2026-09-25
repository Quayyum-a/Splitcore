import * as Joi from 'joi';

// Fails startup immediately with a clear message if the environment is
// misconfigured, instead of letting a missing var surface later as a
// confusing runtime error deep in a request handler.
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),

  PORT: Joi.number().integer().min(1).max(65535).default(3000).messages({
    'number.min': 'PORT must be between 1 and 65535',
    'number.max': 'PORT must be between 1 and 65535',
  }),

  DATABASE_URL: Joi.string()
    .uri()
    .pattern(/^postgresql:\/\//)
    .required()
    .messages({
      'string.pattern.base':
        'DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql://',
      'any.required':
        'DATABASE_URL is required. Format: postgresql://user:password@host:port/database',
    }),

  // Set to false to run the API with no Redis connection at all: queueing is
  // replaced by inline processing and the health check drops its Redis
  // indicator. Intended as a stopgap (exhausted provider quota, local work
  // without infrastructure), not a steady state — see the README.
  REDIS_ENABLED: Joi.boolean().default(true),

  // Managed providers (Upstash, Redis Cloud) hand out a full connection URL,
  // so both `host` and `rediss://user:pw@host:6379` are accepted here;
  // configuration.ts reduces either to the bare host ioredis needs.
  REDIS_HOST: Joi.string()
    .pattern(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^\s/]+$/i)
    .when('REDIS_ENABLED', { is: false, then: Joi.optional(), otherwise: Joi.required() })
    .messages({
      'string.pattern.base':
        'REDIS_HOST must be a hostname, IP address, or a redis:// / rediss:// connection URL',
      'any.required': 'REDIS_HOST is required (hostname, IP address, or connection URL)',
    }),

  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379).messages({
    'number.min': 'REDIS_PORT must be between 1 and 65535',
    'number.max': 'REDIS_PORT must be between 1 and 65535',
  }),

  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // Explicit override for TLS. Unset = inferred from the REDIS_HOST scheme,
  // falling back to "a password means a managed provider, so TLS".
  REDIS_TLS: Joi.boolean().optional().messages({
    'boolean.base': 'REDIS_TLS must be true or false',
  }),

  JWT_SECRET: Joi.string().min(32).required().messages({
    'string.min': 'JWT_SECRET must be at least 32 characters long for security',
    'any.required':
      'JWT_SECRET is required. Generate a secure random string (minimum 32 characters).',
  }),

  JWT_EXPIRES_IN: Joi.string().default('1d').messages({
    'string.base': 'JWT_EXPIRES_IN must be a string (e.g., "1d", "7d", "24h")',
  }),

  SENTRY_DSN: Joi.string().uri().optional().messages({
    'string.uri': 'SENTRY_DSN must be a valid URI format',
  }),

  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0.0).max(1.0).default(0.1).messages({
    'number.min':
      'SENTRY_TRACES_SAMPLE_RATE must be between 0.0 (no tracing) and 1.0 (100% tracing)',
    'number.max':
      'SENTRY_TRACES_SAMPLE_RATE must be between 0.0 (no tracing) and 1.0 (100% tracing)',
  }),

  APP_URL: Joi.string().uri().default('http://localhost:3000').messages({
    'string.uri': 'APP_URL must be a valid URL, e.g. https://api.splitcore.app',
  }),

  ALLOWED_ORIGINS: Joi.string().optional(),

  // Paystack. Required in production and staging: without them the payment
  // endpoints accept requests and then fail at the provider call, and
  // webhook signature verification rejects everything. Optional in
  // development and test so the app boots without live credentials.
  PAYSTACK_SECRET_KEY: Joi.string()
    .pattern(/^sk_(test|live)_/)
    .when('NODE_ENV', {
      is: Joi.valid('production', 'staging'),
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      'string.pattern.base': 'PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_',
      'any.required': 'PAYSTACK_SECRET_KEY is required outside development/test',
    }),

  PAYSTACK_PUBLIC_KEY: Joi.string()
    .pattern(/^pk_(test|live)_/)
    .when('NODE_ENV', {
      is: Joi.valid('production', 'staging'),
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      'string.pattern.base': 'PAYSTACK_PUBLIC_KEY must start with pk_test_ or pk_live_',
      'any.required': 'PAYSTACK_PUBLIC_KEY is required outside development/test',
    }),

  // Where the provider returns the guest after checkout. Unset = the
  // callback configured in the Paystack dashboard is used.
  PAYMENT_CALLBACK_URL: Joi.string().uri().optional().messages({
    'string.uri': 'PAYMENT_CALLBACK_URL must be a valid URL',
  }),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info')
    .messages({
      'any.only': 'LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace',
    }),
});
