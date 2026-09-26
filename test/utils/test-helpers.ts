import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { resetDatabase } from './reset-database';

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

// Delegates rather than reimplementing. This used to loop over pg_tables
// truncating one table at a time - a second cleanup strategy that would drift
// from the suites' own the moment either changed.
export async function cleanupTestDatabase(): Promise<void> {
  if (!prisma) return;
  await resetDatabase(prisma);
}

export async function createTestUser(data?: { email?: string; password?: string; role?: Role }) {
  const email = data?.email || 'test@example.com';
  const password = data?.password || 'Test123!';
  // Role comes from the schema; the platform has PLATFORM_ADMIN and
  // VENUE_ADMIN, and nothing else. A literal union here drifted out of sync
  // with the enum and made every call throw at insert time.
  const role: Role = data?.role ?? Role.PLATFORM_ADMIN;

  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
    },
  });
}

/**
 * Signs a token in the shape JwtStrategy expects: it reads `sub`, so a
 * payload carrying only `userId` authenticates as nobody.
 */
export function generateTestToken(payload: {
  userId: string;
  role: string;
  email?: string;
}): string {
  const jwtService = new JwtService({
    secret: process.env.JWT_SECRET || 'test-secret',
    signOptions: { expiresIn: '3600s' },
  });

  return jwtService.sign({
    sub: payload.userId,
    email: payload.email ?? 'test@example.com',
    role: payload.role,
  });
}

export async function createAuthenticatedTestContext(userData?: {
  email?: string;
  password?: string;
  role?: Role;
}) {
  const user = await createTestUser(userData);
  const token = generateTestToken({ userId: user.id, role: user.role, email: user.email });

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
