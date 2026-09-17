import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  await prisma.$connect();
  console.log('E2E test database connected');
});

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
    console.log('E2E test database disconnected');
  }
});

beforeEach(async () => {
  // Truncate all tables except migrations before each test
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `;

  for (const { tablename } of tables) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE`);
    }
  }
});

export { prisma };
