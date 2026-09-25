export interface AppConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  database: {
    url: string;
  };
  redis: {
    /** When false, nothing in the process opens a Redis connection at all. */
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
    tls: boolean;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  paystack: {
    secretKey?: string;
    publicKey?: string;
    callbackUrl?: string;
  };
  sentry: {
    dsn?: string;
    tracesSampleRate: number;
  };
  logLevel: string;
}

/**
 * Managed Redis providers hand out a connection URL, not a bare hostname, so
 * REDIS_HOST regularly arrives as `rediss://default:pw@host:6379`. ioredis
 * wants the host on its own, and a scheme silently produces a DNS failure
 * that looks like "Redis is down". Strip it here, once.
 *
 * A `rediss://` or `https://` scheme also tells us TLS is required, which is
 * otherwise only guessable.
 */
export function parseRedisHost(raw: string | undefined): { host: string; tlsFromScheme: boolean } {
  const value = (raw ?? 'localhost').trim();
  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  const scheme = schemeMatch?.[1]?.toLowerCase();

  let rest = scheme ? value.slice(schemeMatch![0].length) : value;
  rest = rest.split('/')[0]; // drop any path
  if (rest.includes('@')) rest = rest.slice(rest.lastIndexOf('@') + 1); // drop credentials
  // Strip a trailing :port; IPv6 literals keep their brackets and colons.
  if (!rest.startsWith('[')) rest = rest.replace(/:\d+$/, '');

  return { host: rest || 'localhost', tlsFromScheme: scheme === 'rediss' || scheme === 'https' };
}

export default (): AppConfig => {
  const { host: redisHost, tlsFromScheme } = parseRedisHost(process.env.REDIS_HOST);
  const redisPassword = process.env.REDIS_PASSWORD || undefined;

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3000',

    database: {
      url: process.env.DATABASE_URL!,
    },

    redis: {
      // Opt-out switch for running without Redis entirely — see RedisModule.
      // Anything other than an explicit 'false' keeps Redis on, so this can
      // never be disabled by a typo.
      enabled: process.env.REDIS_ENABLED !== 'false',
      host: redisHost,
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: redisPassword,
      // Explicit REDIS_TLS wins; otherwise infer from the URL scheme, and
      // fall back to "a password implies a managed provider" for the cloud
      // Redis setups this project deploys against.
      tls:
        process.env.REDIS_TLS !== undefined
          ? process.env.REDIS_TLS === 'true'
          : tlsFromScheme || Boolean(redisPassword),
    },

    auth: {
      jwtSecret: process.env.JWT_SECRET!,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
    },

    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY,
      callbackUrl: process.env.PAYMENT_CALLBACK_URL || undefined,
    },

    sentry: {
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    },

    logLevel: process.env.LOG_LEVEL || 'info',
  };
};
