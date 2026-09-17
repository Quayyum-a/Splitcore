import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

let prisma: PrismaClient;

export async function setupTestDatabase(): Promise<PrismaClient> {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  await prisma.$connect();
  return prisma;
}

export async function cleanupTestDatabase(): Promise<void> {
  if (!prisma) return;

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `;

  for (const { tablename } of tables) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE`);
    }
  }
}

export async function createTestUser(data?: {
  email?: string;
  password?: string;
  role?: 'ADMIN' | 'USER';
}) {
  const email = data?.email || 'test@example.com';
  const password = data?.password || 'Test123!';
  const role = data?.role || 'USER';

  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
    },
  });
}

export function generateTestToken(payload: { userId: string; role: string }): string {
  const jwtService = new JwtService({
    secret: process.env.JWT_SECRET || 'test-secret',
    signOptions: { expiresIn: '3600s' },
  });

  return jwtService.sign(payload);
}

export async function createAuthenticatedTestContext(userData?: {
  email?: string;
  password?: string;
  role?: 'ADMIN' | 'USER';
}) {
  const user = await createTestUser(userData);
  const token = generateTestToken({ userId: user.id, role: user.role });

  return {
    user,
    token,
    authHeader: `Bearer ${token}`,
  };
}

export async function teardownTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
