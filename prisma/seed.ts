import { PrismaClient, Role, KycStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Run with: npx prisma db seed
// Idempotent: safe to re-run, uses upsert to avoid duplicates
async function main() {
  console.log('🌱 Starting seed...');

  // 1. Platform Admin
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
  console.log(`✓ Platform admin: ${admin.email}`);

  // 2. Venues
  const venue1 = await prisma.venue.upsert({
    where: { slug: 'quilox-lagos' },
    update: {},
    create: {
      name: 'Quilox Nightclub',
      slug: 'quilox-lagos',
      location: 'Victoria Island, Lagos',
      logoUrl: 'https://example.com/quilox-logo.png',
    },
  });

  const venue2 = await prisma.venue.upsert({
    where: { slug: 'cubana-chief-priest' },
    update: {},
    create: {
      name: 'Cubana Chief Priest Club',
      slug: 'cubana-chief-priest',
      location: 'Lekki Phase 1, Lagos',
      logoUrl: 'https://example.com/cubana-logo.png',
    },
  });

  const venue3 = await prisma.venue.upsert({
    where: { slug: 'eko-hotel-suites' },
    update: {},
    create: {
      name: 'Eko Hotel & Suites',
      slug: 'eko-hotel-suites',
      location: 'Victoria Island, Lagos',
    },
  });
  console.log(`✓ Venues: ${venue1.name}, ${venue2.name}, ${venue3.name}`);

  // 3. Venue Admins
  const venueAdmin1 = await prisma.user.upsert({
    where: { email: 'admin@quilox.com' },
    update: {},
    create: {
      email: 'admin@quilox.com',
      passwordHash: await bcrypt.hash('Quilox123!', 12),
      role: Role.VENUE_ADMIN,
      venueId: venue1.id,
    },
  });

  const venueAdmin2 = await prisma.user.upsert({
    where: { email: 'admin@cubana.com' },
    update: {},
    create: {
      email: 'admin@cubana.com',
      passwordHash: await bcrypt.hash('Cubana123!', 12),
      role: Role.VENUE_ADMIN,
      venueId: venue2.id,
    },
  });
  console.log(`✓ Venue admins: ${venueAdmin1.email}, ${venueAdmin2.email}`);

  // 4. Entertainers with varied KYC status
  const dj1 = await prisma.entertainer.upsert({
    where: { phone: '+2348012345001' },
    update: {},
    create: {
      stageName: 'DJ Neptune',
      legalName: 'Patrick Imohiosen',
      phone: '+2348012345001',
      bankName: 'GTBank',
      accountNumber: '0123456789',
      kycStatus: KycStatus.VERIFIED,
    },
  });

  const dj2 = await prisma.entertainer.upsert({
    where: { phone: '+2348012345002' },
    update: {},
    create: {
      stageName: 'DJ Spinall',
      legalName: 'Sodamola Oluseye Desmond',
      phone: '+2348012345002',
      bankName: 'Access Bank',
      accountNumber: '0987654321',
      kycStatus: KycStatus.PENDING,
    },
  });

  const dj3 = await prisma.entertainer.upsert({
    where: { phone: '+2348012345003' },
    update: {},
    create: {
      stageName: 'Wizkid',
      legalName: 'Ayodeji Ibrahim Balogun',
      phone: '+2348012345003',
      kycStatus: KycStatus.REVIEW,
    },
  });

  const dj4 = await prisma.entertainer.upsert({
    where: { phone: '+2348012345004' },
    update: {},
    create: {
      stageName: 'Burna Boy',
      legalName: 'Damini Ebunoluwa Ogulu',
      phone: '+2348012345004',
      bankName: 'Zenith Bank',
      accountNumber: '1122334455',
      kycStatus: KycStatus.NOT_STARTED,
    },
  });

  const dj5 = await prisma.entertainer.upsert({
    where: { phone: '+2348012345005' },
    update: {},
    create: {
      stageName: 'Davido',
      legalName: 'David Adedeji Adeleke',
      phone: '+2348012345005',
      kycStatus: KycStatus.FAILED,
    },
  });
  console.log(`✓ Entertainers: ${dj1.stageName}, ${dj2.stageName}, ${dj3.stageName}, ${dj4.stageName}, ${dj5.stageName}`);

  // 5. Link entertainers to venues (many-to-many)
  const links = [
    { venueId: venue1.id, entertainerId: dj1.id },
    { venueId: venue1.id, entertainerId: dj2.id },
    { venueId: venue1.id, entertainerId: dj3.id },
    { venueId: venue2.id, entertainerId: dj2.id }, // DJ Spinall works at both venues
    { venueId: venue2.id, entertainerId: dj3.id },
    { venueId: venue2.id, entertainerId: dj4.id },
    { venueId: venue3.id, entertainerId: dj1.id }, // DJ Neptune works at venue 1 and 3
    { venueId: venue3.id, entertainerId: dj5.id },
  ];

  for (const link of links) {
    await prisma.venueEntertainer.upsert({
      where: {
        venueId_entertainerId: {
          venueId: link.venueId,
          entertainerId: link.entertainerId,
        },
      },
      update: {},
      create: link,
    });
  }
  console.log(`✓ Venue-Entertainer links: ${links.length} connections`);

  // 6. QR Codes (mix of venue-only and entertainer-specific)
  const qr1 = await prisma.qrCode.upsert({
    where: { publicToken: 'quilox-vip-table-1-dj-neptune-0001' },
    update: {},
    create: {
      publicToken: 'quilox-vip-table-1-dj-neptune-0001',
      venueId: venue1.id,
      entertainerId: dj1.id,
      location: 'VIP Table 1',
    },
  });

  const qr2 = await prisma.qrCode.upsert({
    where: { publicToken: 'quilox-general-area-bar-counter-02' },
    update: {},
    create: {
      publicToken: 'quilox-general-area-bar-counter-02',
      venueId: venue1.id,
      entertainerId: null, // Venue-only
      location: 'Bar Counter',
    },
  });

  const qr3 = await prisma.qrCode.upsert({
    where: { publicToken: 'cubana-table-5-dj-spinall-00000003' },
    update: {},
    create: {
      publicToken: 'cubana-table-5-dj-spinall-00000003',
      venueId: venue2.id,
      entertainerId: dj2.id,
      location: 'Table 5',
    },
  });

  const qr4 = await prisma.qrCode.upsert({
    where: { publicToken: 'eko-hotel-lounge-entrance-poster-04' },
    update: {},
    create: {
      publicToken: 'eko-hotel-lounge-entrance-poster-04',
      venueId: venue3.id,
      entertainerId: null, // Venue-only
      location: 'Lounge Entrance',
    },
  });
  console.log(`✓ QR Codes: 4 codes created (2 venue-only, 2 entertainer-specific)`);

  // 7. Split Rules (one per venue) - check if exists first
  const existingRule1 = await prisma.splitRule.findFirst({
    where: { venueId: venue1.id, effectiveTo: null },
  });

  if (!existingRule1) {
    await prisma.splitRule.create({
      data: {
        venueId: venue1.id,
        entertainerBps: 7000, // 70%
        venueBps: 2500, // 25%
        platformBps: 500, // 5%
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
      },
    });
  }

  const existingRule2 = await prisma.splitRule.findFirst({
    where: { venueId: venue2.id, effectiveTo: null },
  });

  if (!existingRule2) {
    await prisma.splitRule.create({
      data: {
        venueId: venue2.id,
        entertainerBps: 6500, // 65%
        venueBps: 3000, // 30%
        platformBps: 500, // 5%
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
      },
    });
  }

  const existingRule3 = await prisma.splitRule.findFirst({
    where: { venueId: venue3.id, effectiveTo: null },
  });

  if (!existingRule3) {
    await prisma.splitRule.create({
      data: {
        venueId: venue3.id,
        entertainerBps: 8000, // 80%
        venueBps: 1500, // 15%
        platformBps: 500, // 5%
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
      },
    });
  }
  console.log(`✓ Split rules: 3 venue rules created`);

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Credentials:');
  console.log(`  Platform Admin: ${admin.email} / ${!process.env.SEED_ADMIN_PASSWORD ? 'ChangeMe123!' : '[env: SEED_ADMIN_PASSWORD]'}`);
  console.log(`  Venue Admin 1: admin@quilox.com / Quilox123!`);
  console.log(`  Venue Admin 2: admin@cubana.com / Cubana123!`);
  console.log('');
  console.log('Sample QR tokens to test Guest endpoint (GET /t/:publicToken):');
  console.log(`  ${qr1.publicToken}`);
  console.log(`  ${qr2.publicToken}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
