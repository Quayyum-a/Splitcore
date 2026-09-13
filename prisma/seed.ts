import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Run with: npx prisma db seed
// There's no public registration endpoint by design (see auth.controller.ts),
// so the very first platform admin has to come from somewhere — this is that
// somewhere. Safe to re-run: it upserts rather than duplicating.
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@splitcore.dev';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: Role.PLATFORM_ADMIN,
    },
  });

  console.log(`Seeded platform admin: ${admin.email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Default password is "ChangeMe123!" — set SEED_ADMIN_PASSWORD to override, and change it after first login.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
