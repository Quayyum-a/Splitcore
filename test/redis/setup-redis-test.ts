// Jest setupFile for the E2E project (see test/jest-e2e.json).
//
// It runs before EVERY e2e suite, so it must only establish a sane baseline.
// It deliberately does NOT point Redis at an unreachable host: the
// graceful-degradation suite supplies its own failing config, and forcing a
// broken Redis on every suite would break the payment and webhook e2e tests
// that legitimately enqueue jobs.
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '../../.env');

if (fs.existsSync(envPath)) {
  const envVars = fs
    .readFileSync(envPath, 'utf-8')
    .split('\n')
    .reduce((acc: Record<string, string>, line: string) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) acc[match[1].trim()] = match[2].trim();
      return acc;
    }, {});

  // Real environment variables (CI, a shell export) always win over .env.
  for (const key of Object.keys(envVars)) {
    if (process.env[key] === undefined) process.env[key] = envVars[key];
  }
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';

console.log(
  `[SETUP] e2e env ready — DATABASE_URL=${maskUrl(process.env.DATABASE_URL)} REDIS_HOST=${process.env.REDIS_HOST}`,
);

// Never print database credentials into test/CI logs.
function maskUrl(url: string | undefined): string | undefined {
  return url?.replace(/\/\/[^@/]*@/, '//***@');
}
