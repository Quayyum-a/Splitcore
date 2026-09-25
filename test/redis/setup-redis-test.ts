// Jest setup file to configure environment variables before tests run
// This file is executed by Jest via setupFiles configuration

// Use a conditional to detect if we're loading from a .env file or setting manually
// When running e2e tests, we need valid DATABASE_URL, JWT_SECRET, etc.
const fs = require('fs');
const path = require('path');

console.log('[SETUP] Loading environment variables...');
console.log('[SETUP] Current DATABASE_URL:', process.env.DATABASE_URL);

// Try to load .env file if it exists
const envPath = path.join(__dirname, '../../.env');
console.log('[SETUP] Looking for .env at:', envPath);
console.log('[SETUP] .env exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envVars = envContent.split('\n').reduce(
    (acc: Record<string, string>, line: string) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        acc[match[1].trim()] = match[2].trim();
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  console.log('[SETUP] Loaded vars from .env:', Object.keys(envVars));

  // Set environment variables if not already set
  Object.keys(envVars).forEach((key) => {
    if (!process.env[key]) {
      process.env[key] = envVars[key];
    }
  });
}

// Override specific variables for Redis failure testing
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = 'failing-redis.local';
process.env.REDIS_PORT = '6379';
process.env.REDIS_PASSWORD = 'test-password';
process.env.LOG_LEVEL = 'error';

console.log('[SETUP] Final DATABASE_URL:', process.env.DATABASE_URL);
console.log('[SETUP] Final REDIS_HOST:', process.env.REDIS_HOST);
