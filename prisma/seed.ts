import { PrismaClient, Role, KycStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// Run with: npx prisma db seed
// Idempotent: safe to re-run, uses upsert to avoid duplicates

const DEV_DEFAULTS = {
  admin: 'ChangeMe123!',
  venue1: 'Quilox123!',
  venue2: 'Cubana123!',
};

// The fallbacks below are committed to a public repository, so anyone can read
// them. Outside development they would be live credentials on an
// internet-facing API, so require them to be supplied explicitly instead.
function seedPassword(envVar: string, devDefault: string): string {
  const supplied = process.env[envVar];
  if (supplied) return supplied;

  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' || env === 'staging') {
    throw new Error(
      `${envVar} must be set when seeding with NODE_ENV=${env}. The development ` +
        'default is published in this repository and would be a known password on ' +
        'a live deployment.',
    );
  }
  return devDefault;
}

async function main() {
  console.log('🌱 Starting seed...');

  // 1. Platform Admin
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@splitcore.dev';
  const password = seedPassword('SEED_ADMIN_PASSWORD', DEV_DEFAULTS.admin);
  const passwordHash = await bcrypt.hash(password, 12);
  const venue1Password = seedPassword('SEED_VENUE1_PASSWORD', DEV_DEFAULTS.venue1);
  const venue2Password = seedPassword('SEED_VENUE2_PASSWORD', DEV_DEFAULTS.venue2);

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
    },
  });

  const venue2 = await prisma.venue.upsert({
    where: { slug: 'cubana-chief-priest' },
    update: {},
    create: {
      name: 'Cubana Chief Priest Club',
      slug: 'cubana-chief-priest',
      location: 'Lekki Phase 1, Lagos',
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
      passwordHash: await bcrypt.hash(venue1Password, 12),
      role: Role.VENUE_ADMIN,
      venueId: venue1.id,
    },
  });

  const venueAdmin2 = await prisma.user.upsert({
    where: { email: 'admin@cubana.com' },
    update: {},
    create: {
      email: 'admin@cubana.com',
      passwordHash: await bcrypt.hash(venue2Password, 12),
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
      // A VERIFIED entertainer in demo data should look like one who actually
      // completed onboarding: payouts require a confirmed destination, so
      // without these the demo would hold every payout.
      bankCode: '058',
      resolvedAccountName: 'PATRICK IMOHIOSEN',
      accountResolvedAt: new Date('2024-01-01'),
      accountConfirmedAt: new Date('2024-01-01'),
      kycSubmittedAt: new Date('2024-01-01'),
      kycVerifiedAt: new Date('2024-01-01'),
      identityCheckType: 'BVN',
      identityCheckedAt: new Date('2024-01-01'),
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
  console.log(
    `✓ Entertainers: ${dj1.stageName}, ${dj2.stageName}, ${dj3.stageName}, ${dj4.stageName}, ${dj5.stageName}`,
  );

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

  // 7. Platform settings. One global fee, admin-only. The migration seeds this
  // row; upserting keeps the seed runnable against a database restored from
  // before governance existed.
  await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', platformFeeBps: 500 },
  });
  console.log('✓ Platform settings: 5% platform fee');

  // 8. Split rules.
  //
  // Seeded as already-agreed rules (VENUE_PROPOSAL + ACCEPTED) rather than
  // written straight to ACTIVE, with the audit events a real agreement would
  // have produced. A demo that shows an active split with no history behind it
  // teaches the wrong thing about how this system works.
  const AGREED_AT = new Date('2024-01-01');

  async function seedAgreedRule(
    venueId: string,
    entertainerId: string,
    shares: { entertainerBps: number; venueBps: number },
  ) {
    const existing = await prisma.splitRule.findFirst({
      where: { venueId, status: 'ACTIVE', effectiveTo: null },
    });
    if (existing) return existing;

    const rule = await prisma.splitRule.create({
      data: {
        venueId,
        entertainerId,
        entertainerBps: shares.entertainerBps,
        venueBps: shares.venueBps,
        platformBps: 500,
        status: 'ACTIVE',
        origin: 'VENUE_PROPOSAL',
        effectiveFrom: AGREED_AT,
        effectiveTo: null,
        proposedAt: AGREED_AT,
        respondedAt: AGREED_AT,
        // Spent: the entertainer already answered.
        responseTokenHash: null,
      },
    });

    await prisma.splitRuleAuditEvent.createMany({
      data: [
        {
          splitRuleId: rule.id,
          event: 'PROPOSED',
          actorType: 'VENUE_ADMIN',
          detail: { seeded: true, ...shares, platformBps: 500 },
        },
        {
          splitRuleId: rule.id,
          event: 'ACCEPTED',
          actorType: 'ENTERTAINER',
          actorId: entertainerId,
          detail: { seeded: true, via: 'CONSENT_TOKEN_LINK' },
        },
      ],
    });

    return rule;
  }

  await seedAgreedRule(venue1.id, dj1.id, { entertainerBps: 7000, venueBps: 2500 }); // 70/25/5
  await seedAgreedRule(venue2.id, dj2.id, { entertainerBps: 6500, venueBps: 3000 }); // 65/30/5
  await seedAgreedRule(venue3.id, dj3.id, { entertainerBps: 8000, venueBps: 1500 }); // 80/15/5
  console.log('✓ Split rules: 3 agreed rules, each with its consent audit trail');

  // One open proposal, so the consent flow is demonstrable without having to
  // create anything by hand. The token is printed below; it is the only copy.
  let pendingConsentUrl: string | null = null;
  const openProposal = await prisma.splitRule.findFirst({
    where: { venueId: venue1.id, status: 'PENDING_ENTERTAINER_APPROVAL' },
  });
  if (!openProposal) {
    const consentToken = randomBytes(32).toString('hex');
    const proposal = await prisma.splitRule.create({
      data: {
        venueId: venue1.id,
        entertainerId: dj1.id,
        entertainerBps: 7500,
        venueBps: 2000,
        platformBps: 500,
        status: 'PENDING_ENTERTAINER_APPROVAL',
        origin: 'VENUE_PROPOSAL',
        // Null on purpose: not in force until accepted.
        effectiveFrom: null,
        responseTokenHash: createHash('sha256').update(consentToken).digest('hex'),
      },
    });
    await prisma.splitRuleAuditEvent.create({
      data: {
        splitRuleId: proposal.id,
        event: 'PROPOSED',
        actorType: 'VENUE_ADMIN',
        detail: { seeded: true, entertainerBps: 7500, venueBps: 2000, platformBps: 500 },
      },
    });
    const base = process.env.FRONTEND_URL ?? process.env.APP_URL ?? 'http://localhost:3000';
    pendingConsentUrl = `${base.replace(/\/+$/, '')}/split-rules/${proposal.id}/respond/${consentToken}`;
  }
  console.log('✓ One pending proposal for Quilox (75/20/5) awaiting DJ Neptune');

  // Phase 3 Note: Payment data cannot be seeded directly
  // Payments require actual Paystack API calls and webhook processing
  // To test payment flow:
  // 1. Start the app: npm run start:dev
  // 2. Scan QR code (GET /t/:publicToken) to create guest session
  // 3. Initialize payment (POST /payments/initialize) with session ID
  // 4. Complete payment on Paystack's hosted checkout page
  // 5. Webhook will process payment, create ledger entries, trigger payouts
  //
  // Sample test flow:
  //   GET /t/quilox-vip-table-1-dj-neptune-0001
  //   -> returns sessionId
  //   POST /payments/initialize
  //   {
  //     "sessionId": "<from_above>",
  //     "amountKobo": 500000,  // ₦5,000
  //     "guestDisplayName": "Anonymous Fan",
  //     "displayNameEnabled": true
  //   }
  //   -> redirects to Paystack checkout
  //   -> webhook processes payment
  //   -> ledger entries created (PROCESSOR_CLEARING debit, entertainer/venue/platform credits)
  //   -> payout triggered for VERIFIED entertainer (DJ Neptune)
  console.log('');
  console.log('💡 Payment Testing: See Phase 3 notes in seed.ts for test flow');

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Credentials:');
  const shown = (envVar: string, devDefault: string) =>
    process.env[envVar] ? `[env: ${envVar}]` : devDefault;
  console.log(
    `  Platform Admin: ${admin.email} / ${shown('SEED_ADMIN_PASSWORD', DEV_DEFAULTS.admin)}`,
  );
  console.log(
    `  Venue Admin 1: admin@quilox.com / ${shown('SEED_VENUE1_PASSWORD', DEV_DEFAULTS.venue1)}`,
  );
  console.log(
    `  Venue Admin 2: admin@cubana.com / ${shown('SEED_VENUE2_PASSWORD', DEV_DEFAULTS.venue2)}`,
  );
  if (pendingConsentUrl) {
    console.log('');
    console.log('Pending split proposal — give this link to the entertainer:');
    console.log(`  ${pendingConsentUrl}`);
    console.log('  (shown once; the raw token is not stored)');
  }

  console.log('');
  console.log('Sample QR tokens to test Guest endpoint (GET /t/:publicToken):');
  console.log(`  ${qr1.publicToken}`);
  console.log(`  ${qr2.publicToken}`);
  console.log('');
  console.log('Entertainer KYC Status:');
  console.log(`  ${dj1.stageName}: VERIFIED (will receive instant payouts)`);
  console.log(`  ${dj2.stageName}: PENDING (payouts queued until KYC complete)`);
  console.log(`  ${dj3.stageName}: REVIEW (payouts queued)`);
  console.log(`  ${dj4.stageName}: NOT_STARTED (payouts queued)`);
  console.log(`  ${dj5.stageName}: FAILED (payouts queued)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
