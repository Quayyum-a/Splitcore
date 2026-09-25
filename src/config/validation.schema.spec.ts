/**
 * Unit tests for environment validation and config derivation.
 *
 * Covers phase-1-production-ready task 16.1. The point of the Joi schema is
 * that a misconfigured environment fails loudly at boot rather than quietly
 * at the first request that needs the missing value.
 */

import { validationSchema } from './validation.schema';
import configuration, { parseRedisHost } from './configuration';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/splitcore',
  REDIS_HOST: 'localhost',
  JWT_SECRET: 'a'.repeat(32),
};

function validate(overrides: Record<string, unknown> = {}) {
  return validationSchema.validate({ ...BASE_ENV, ...overrides }, { abortEarly: false });
}

describe('validationSchema', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.JWT_EXPIRES_IN).toBe('1d');
    expect(value.LOG_LEVEL).toBe('info');
  });

  describe('DATABASE_URL', () => {
    it('is required', () => {
      const { error } = validationSchema.validate(
        { REDIS_HOST: 'localhost', JWT_SECRET: 'a'.repeat(32) },
        { abortEarly: false },
      );
      expect(error?.message).toContain('DATABASE_URL is required');
    });

    it('rejects a non-postgres connection string', () => {
      const { error } = validate({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' });
      expect(error?.message).toContain('postgresql://');
    });
  });

  describe('JWT_SECRET', () => {
    it('is required', () => {
      const { error } = validationSchema.validate(
        { DATABASE_URL: BASE_ENV.DATABASE_URL, REDIS_HOST: 'localhost' },
        { abortEarly: false },
      );
      expect(error?.message).toContain('JWT_SECRET is required');
    });

    it('rejects a secret shorter than 32 characters', () => {
      const { error } = validate({ JWT_SECRET: 'too-short' });
      expect(error?.message).toContain('at least 32 characters');
    });
  });

  describe('REDIS_HOST', () => {
    it.each(['localhost', '10.0.0.5', 'famous-griffon-165164.upstash.io'])(
      'accepts the bare host %s',
      (host) => {
        expect(validate({ REDIS_HOST: host }).error).toBeUndefined();
      },
    );

    it.each([
      'rediss://default:secret@famous-griffon-165164.upstash.io:6379',
      'redis://localhost:6379',
      'https://famous-griffon-165164.upstash.io',
    ])('accepts the connection URL %s that managed providers hand out', (host) => {
      expect(validate({ REDIS_HOST: host }).error).toBeUndefined();
    });

    it('is required', () => {
      const { error } = validationSchema.validate(
        { DATABASE_URL: BASE_ENV.DATABASE_URL, JWT_SECRET: 'a'.repeat(32) },
        { abortEarly: false },
      );
      expect(error?.message).toContain('REDIS_HOST is required');
    });
  });

  describe('PORT', () => {
    it.each([0, 70000])('rejects out-of-range port %s', (port) => {
      expect(validate({ PORT: port }).error?.message).toContain('between 1 and 65535');
    });
  });

  describe('LOG_LEVEL', () => {
    it('rejects an unknown level', () => {
      expect(validate({ LOG_LEVEL: 'verbose' }).error?.message).toContain(
        'LOG_LEVEL must be one of',
      );
    });
  });

  describe('Paystack credentials', () => {
    it('are optional in development so the app boots without live keys', () => {
      expect(validate({ NODE_ENV: 'development' }).error).toBeUndefined();
    });

    it('are required in production', () => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(error?.message).toContain('PAYSTACK_SECRET_KEY is required');
      expect(error?.message).toContain('PAYSTACK_PUBLIC_KEY is required');
    });

    it('accept valid production keys', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        PAYSTACK_SECRET_KEY: 'sk_live_abc123',
        PAYSTACK_PUBLIC_KEY: 'pk_live_abc123',
      });
      expect(error).toBeUndefined();
    });

    it('reject a public key pasted into the secret slot', () => {
      const { error } = validate({ PAYSTACK_SECRET_KEY: 'pk_test_abc123' });
      expect(error?.message).toContain('sk_test_ or sk_live_');
    });
  });
});

describe('parseRedisHost', () => {
  it.each([
    ['localhost', 'localhost', false],
    ['famous-griffon-165164.upstash.io', 'famous-griffon-165164.upstash.io', false],
    ['redis://localhost:6379', 'localhost', false],
    ['rediss://host.upstash.io:6379', 'host.upstash.io', true],
    ['https://host.upstash.io', 'host.upstash.io', true],
    ['rediss://default:sup3rsecret@host.upstash.io:6379', 'host.upstash.io', true],
    ['redis://host.example.com:6379/0', 'host.example.com', false],
    ['  localhost  ', 'localhost', false],
  ])('reduces %s to host %s', (input, host, tlsFromScheme) => {
    expect(parseRedisHost(input)).toEqual({ host, tlsFromScheme });
  });

  it('defaults to localhost when unset', () => {
    expect(parseRedisHost(undefined)).toEqual({ host: 'localhost', tlsFromScheme: false });
  });

  it('keeps an IPv6 literal intact', () => {
    expect(parseRedisHost('[::1]').host).toBe('[::1]');
  });
});

describe('configuration()', () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it('normalizes a provider connection URL into host + TLS', () => {
    process.env.REDIS_HOST = 'rediss://default:pw@host.upstash.io:6379';
    process.env.REDIS_PASSWORD = 'pw';
    delete process.env.REDIS_TLS;

    const config = configuration();

    expect(config.redis.host).toBe('host.upstash.io');
    expect(config.redis.tls).toBe(true);
  });

  it('lets REDIS_TLS override the inferred value', () => {
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PASSWORD = 'local-dev-password';
    process.env.REDIS_TLS = 'false';

    // A password-protected local Redis speaks plain TCP; inferring TLS from
    // the password alone would make it unreachable.
    expect(configuration().redis.tls).toBe(false);
  });

  it('assumes TLS for a password-protected host with no scheme', () => {
    process.env.REDIS_HOST = 'host.upstash.io';
    process.env.REDIS_PASSWORD = 'pw';
    delete process.env.REDIS_TLS;

    expect(configuration().redis.tls).toBe(true);
  });

  it('exposes Paystack credentials under the paystack namespace', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc';
    process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_abc';
    process.env.PAYMENT_CALLBACK_URL = 'https://app.example.com/confirming';

    expect(configuration().paystack).toEqual({
      secretKey: 'sk_test_abc',
      publicKey: 'pk_test_abc',
      callbackUrl: 'https://app.example.com/confirming',
    });
  });
});
