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

  REDIS_HOST: Joi.string().hostname().required().messages({
    'string.hostname': 'REDIS_HOST must be a valid hostname or IP address',
    'any.required': 'REDIS_HOST is required (hostname or IP address)',
  }),

  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379).messages({
    'number.min': 'REDIS_PORT must be between 1 and 65535',
    'number.max': 'REDIS_PORT must be between 1 and 65535',
  }),

  REDIS_PASSWORD: Joi.string().allow('').optional(),

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

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info')
    .messages({
      'any.only': 'LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace',
    }),
});
