import { PrismaClient } from '@prisma/client';

/**
 * The one way an E2E suite resets the database.
 *
 * Every suite used to bring its own cleanup: some truncated, some deleted a
 * hand-picked list of models in a hand-picked order, one truncated a single
 * table, and a fourth strategy sat unused in test/setup-e2e.ts. Running those
 * against one shared Postgres produced exactly what CI showed — deadlocks
 * (40P01) between a DELETE and a TRUNCATE, foreign-key violations when one
 * suite removed venues another still referenced, and duplicate `venue-one`
 * slugs from two suites seeding the same fixture at once.
 *
 * A single TRUNCATE ... CASCADE is used deliberately:
 *  - one statement, one lock acquisition, so there is no window for two
 *    cleanups to interleave and deadlock;
 *  - CASCADE removes the foreign-key ordering problem entirely, rather than
 *    asking every suite to get the order right;
 *  - it cannot leave residual rows behind after a partial failure, which is
 *    how the stray `venue-one` survived.
 *
 * The table list is the full set of @@map names in prisma/schema.prisma.
 * _prisma_migrations is deliberately excluded. If a model is added, add it
 * here — a missing table means state leaks between suites again.
 */
const TABLES = [
  'payouts',
  'ledger_entries',
  'ledger_accounts',
  'webhook_events',
  'payment_transactions',
  'guest_sessions',
  'qr_codes',
  'split_rule_audit_events',
  'split_rules',
  'venue_entertainers',
  'entertainers',
  'users',
  'venues',
  'platform_settings',
] as const;

/** Matches the value seeded by the split_rule_governance migration. */
const DEFAULT_PLATFORM_FEE_BPS = 500;

// Typed as PrismaClient, not PrismaService, so the app's injected service
// (which extends it) and a standalone client both use this one implementation.
/**
 * This function truncates every table. The repository's own .env points
 * DATABASE_URL at the production Supabase instance, so `npm run test:e2e` from a
 * developer machine would erase production without this check. Refusing is the
 * only safe default: the cost of being wrong in the other direction is a failed
 * test run, and the cost here is the whole database.
 */
function assertSafeToTruncate(): void {
  const url = process.env.DATABASE_URL ?? '';
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv !== 'test') {
    throw new Error(
      `resetDatabase() refused to run: NODE_ENV is "${nodeEnv ?? 'unset'}", not "test". ` +
        'This truncates every table.',
    );
  }

  let host: string;
  let database: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, '');
  } catch {
    throw new Error('resetDatabase() refused to run: DATABASE_URL is missing or unparseable.');
  }

  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const namedForTesting = /test/i.test(database);

  if (!localHost && !namedForTesting) {
    throw new Error(
      `resetDatabase() refused to run against "${database}" on host "${host}". ` +
        'It only runs on a local host or a database whose name contains "test". ' +
        'Point DATABASE_URL at a throwaway database before running the E2E suite.',
    );
  }
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  assertSafeToTruncate();

  const list = TABLES.map((table) => `"public"."${table}"`).join(', ');

  // ledger_entries and split_rule_audit_events carry row-level immutability
  // triggers that reject UPDATE and DELETE. TRUNCATE is statement-level, so it
  // is unaffected — which is the other reason deleteMany() was the wrong tool
  // for those two tables.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);

  // platform_settings is configuration rather than fixture data, but it is
  // still shared mutable state: a suite that changes the platform fee would
  // otherwise leak the new value into every test that followed. Truncating and
  // restoring it means every suite starts from a known 5%.
  await prisma.platformSettings.create({
    data: { id: 'singleton', platformFeeBps: DEFAULT_PLATFORM_FEE_BPS },
  });
}
