// Jest setupFile for the unit suite (see jest.config.js).
//
// Importing @prisma/client loads the developer's .env into process.env so it
// can find DATABASE_URL. That is fine for the database, but it also drags in
// REDIS_HOST / REDIS_PASSWORD — which is how the unit suite ended up opening
// connections to the *production* Redis, burning its request quota and
// failing whenever that quota ran out.
//
// dotenv never overwrites a variable that is already set, so pinning the
// infrastructure config here (before any test file is imported) wins over
// .env while still deferring to real environment variables from CI or the
// shell.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
// Empty, not unset: an unset value would let .env supply the production one.
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? '';
