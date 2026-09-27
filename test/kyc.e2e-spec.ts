/**
 * E2E tests for entertainer KYC onboarding.
 *
 * The first block is a named regression suite for a real fraud path that shipped
 * live: `confirm-account` and `verify-identity` allowed VENUE_ADMIN. A venue
 * admin could submit bank details for any entertainer at their venue, resolve
 * them, and then confirm them - their own account included - and the stored
 * record was indistinguishable from the entertainer having confirmed it
 * themselves. Verified against production before the fix: both endpoints
 * answered 400 (a business error), not 403, which is how we knew authorization
 * had let the venue admin through.
 *
 * These must be asserted end to end, not in a unit test: the property being
 * checked belongs to the guard chain, and a unit test calling the controller
 * method never runs a guard.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Entertainer, KycStatus, Role, Venue } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/reset-database';

describe('Entertainer KYC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let venue: Venue;
  let entertainer: Entertainer;
  let platformAdminToken: string;
  let venueAdminToken: string;
  let entertainerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed();
  });

  async function seed() {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    venue = await prisma.venue.create({
      data: { name: 'Quilox', slug: 'quilox-kyc', location: 'Lagos' },
    });
    entertainer = await prisma.entertainer.create({
      data: {
        stageName: 'DJ Neptune',
        legalName: 'Patrick Imohiosen',
        phone: '+2348044444444',
        // Already resolved, so confirm-account is reachable on its merits and
        // the only thing standing between a caller and success is the guard.
        bankName: 'GTBank',
        bankCode: '058',
        accountNumber: '0123456789',
        resolvedAccountName: 'PATRICK IMOHIOSEN',
        accountResolvedAt: new Date(),
        kycStatus: KycStatus.PENDING,
      },
    });
    await prisma.venueEntertainer.create({
      data: { venueId: venue.id, entertainerId: entertainer.id },
    });

    platformAdminToken = jwtService.sign(
      await prisma.user
        .create({
          data: { email: 'platform@splitcore.dev', passwordHash, role: Role.PLATFORM_ADMIN },
        })
        .then((u) => ({ sub: u.id, email: u.email, role: u.role })),
    );
    venueAdminToken = jwtService.sign(
      await prisma.user
        .create({
          data: {
            email: 'venue@splitcore.dev',
            passwordHash,
            role: Role.VENUE_ADMIN,
            venueId: venue.id,
          },
        })
        .then((u) => ({ sub: u.id, email: u.email, role: u.role })),
    );
    entertainerToken = jwtService.sign({
      sub: entertainer.id,
      email: '',
      role: Role.ENTERTAINER,
      entertainerId: entertainer.id,
    });
  }

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  const confirmPath = () => `/entertainers/${entertainer.id}/kyc/confirm-account`;
  const verifyPath = () => `/entertainers/${entertainer.id}/kyc/verify-identity`;
  const CONFIRM_BODY = { confirmedAccountName: 'PATRICK IMOHIOSEN' };
  const IDENTITY_BODY = { documentType: 'BVN', documentNumber: '22222222222' };

  describe('REGRESSION: only the entertainer may confirm their own account', () => {
    // The fraud path. A venue admin at this entertainer's OWN venue - so
    // EntertainerScopedGuard is satisfied and the only thing that can stop them
    // is the role restriction.
    it('403s a VENUE_ADMIN confirming an account for an entertainer at their own venue', async () => {
      await post(venueAdminToken, confirmPath(), CONFIRM_BODY).expect(403);

      const after = await prisma.entertainer.findUniqueOrThrow({ where: { id: entertainer.id } });
      expect(after.accountConfirmedAt).toBeNull();
    });

    it('403s a VENUE_ADMIN submitting an identity document for their entertainer', async () => {
      await post(venueAdminToken, verifyPath(), IDENTITY_BODY).expect(403);

      const after = await prisma.entertainer.findUniqueOrThrow({ where: { id: entertainer.id } });
      expect(after.identityCheckType).toBeNull();
      expect(after.kycStatus).toBe(KycStatus.PENDING);
    });

    // No admin override either: an admin confirming on someone's behalf is the
    // same act regardless of which admin does it.
    it('403s a PLATFORM_ADMIN on both steps', async () => {
      await post(platformAdminToken, confirmPath(), CONFIRM_BODY).expect(403);
      await post(platformAdminToken, verifyPath(), IDENTITY_BODY).expect(403);
    });

    it('lets the entertainer themselves confirm', async () => {
      const response = await post(entertainerToken, confirmPath(), CONFIRM_BODY).expect(201);

      expect(response.body.accountConfirmedAt).not.toBeNull();
      expect(response.body.nextStep).toBe('VERIFY_IDENTITY');
    });

    it("still stops an entertainer confirming somebody else's account", async () => {
      const other = await prisma.entertainer.create({
        data: { stageName: 'DJ Other', legalName: 'Other P', phone: '+2348055555555' },
      });

      await post(
        entertainerToken,
        `/entertainers/${other.id}/kyc/confirm-account`,
        CONFIRM_BODY,
      ).expect(403);
    });
  });

  describe('the admin-assisted steps stay admin-assisted, on purpose', () => {
    // Capturing and resolving bank details asserts nothing about identity, so a
    // venue admin helping an entertainer get started is a real convenience. The
    // asymmetry with confirm-account is deliberate, not an oversight.
    it('lets a VENUE_ADMIN submit bank details', async () => {
      await post(venueAdminToken, `/entertainers/${entertainer.id}/kyc/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);
    });

    it('lets a VENUE_ADMIN read KYC status', async () => {
      await get(venueAdminToken, `/entertainers/${entertainer.id}/kyc/status`).expect(200);
    });

    it('stops a VENUE_ADMIN touching an entertainer who performs elsewhere', async () => {
      const elsewhere = await prisma.entertainer.create({
        data: { stageName: 'DJ Elsewhere', legalName: 'Else P', phone: '+2348066666666' },
      });

      await get(venueAdminToken, `/entertainers/${elsewhere.id}/kyc/status`).expect(403);
    });
  });

  describe('status reporting', () => {
    it('never returns the full account number', async () => {
      const response = await get(
        entertainerToken,
        `/entertainers/${entertainer.id}/kyc/status`,
      ).expect(200);

      expect(response.body.accountNumberMasked).toBe('******6789');
      expect(JSON.stringify(response.body)).not.toContain('0123456789');
    });

    it('reports payoutsEnabled false until both verification and confirmation exist', async () => {
      const response = await get(
        entertainerToken,
        `/entertainers/${entertainer.id}/kyc/status`,
      ).expect(200);

      expect(response.body.payoutsEnabled).toBe(false);
    });
  });
});
