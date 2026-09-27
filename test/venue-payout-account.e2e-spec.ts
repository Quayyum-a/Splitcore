/**
 * E2E tests for the venue's own payout account, and for keeping a venue's share
 * visibly distinct from its entertainers'.
 *
 * Two properties here can only be checked end to end, because both live in the
 * guard chain rather than in a service: that a venue admin CAN confirm their own
 * venue's account (the opposite of the entertainer rule, and deliberately so),
 * and that they cannot touch another venue's.
 *
 * `resolve-account` is exercised by pre-setting what the bank returned rather
 * than calling out, since CI has no real provider key. GET /banks IS called for
 * real: with a placeholder key the provider fails and the service falls back to
 * its static list, which is exactly the cold-start path worth proving.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Role, Venue } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/reset-database';

describe('Venue payout account (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let venue: Venue;
  let otherVenue: Venue;
  let venueAdminToken: string;
  let platformAdminToken: string;

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

  function tokenFor(user: { id: string; email: string; role: Role }): string {
    return jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }

  async function seed() {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    venue = await prisma.venue.create({
      data: { name: 'Quilox', slug: 'quilox-payout', location: 'Lagos' },
    });
    otherVenue = await prisma.venue.create({
      data: { name: 'Cubana', slug: 'cubana-payout', location: 'Abuja' },
    });

    venueAdminToken = tokenFor(
      await prisma.user.create({
        data: {
          email: 'venue@splitcore.dev',
          passwordHash,
          role: Role.VENUE_ADMIN,
          venueId: venue.id,
        },
      }),
    );
    platformAdminToken = tokenFor(
      await prisma.user.create({
        data: { email: 'platform@splitcore.dev', passwordHash, role: Role.PLATFORM_ADMIN },
      }),
    );
  }

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  const base = () => `/venues/${venue.id}/payout-account`;

  /** Stands in for a real provider round trip. */
  async function pretendResolved(name = 'QUILOX ENTERTAINMENT LIMITED') {
    await prisma.venue.update({
      where: { id: venue.id },
      data: { resolvedAccountName: name, accountResolvedAt: new Date() },
    });
  }

  describe('GET /banks', () => {
    it('returns a usable list even when the provider cannot be reached', async () => {
      const response = await get(venueAdminToken, '/banks').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toEqual({
        name: expect.any(String),
        code: expect.any(String),
      });
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/banks').expect(401);
    });
  });

  describe('the three-step flow', () => {
    it('starts at BANK_DETAILS', async () => {
      const response = await get(venueAdminToken, `${base()}/status`).expect(200);

      expect(response.body).toMatchObject({
        venueId: venue.id,
        venueName: 'Quilox',
        nextStep: 'BANK_DETAILS',
        payoutsEnabled: false,
      });
    });

    it('accepts a bank name and stores the resolved code', async () => {
      const response = await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);

      expect(response.body.bankCode).toBe('058');
      expect(response.body.nextStep).toBe('RESOLVE_ACCOUNT');
      // Never echoes the full number back.
      expect(response.body.accountNumberMasked).toBe('******6789');
      expect(JSON.stringify(response.body)).not.toContain('0123456789');
    });

    it('rejects a bank nobody has heard of rather than guessing', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'Bank of Nowhere',
        accountNumber: '0123456789',
      }).expect(400);
    });

    it('rejects a malformed account number', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '123',
      }).expect(400);
    });

    it('will not confirm before the account has been resolved', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);

      await post(venueAdminToken, `${base()}/confirm-account`, {
        confirmedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
      }).expect(400);
    });

    // The deliberate contrast with the entertainer flow: here the venue admin is
    // the account holder's representative, so they are the right party.
    it('lets a VENUE_ADMIN confirm their own venue account, enabling payouts', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);
      await pretendResolved();

      const response = await post(venueAdminToken, `${base()}/confirm-account`, {
        confirmedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
      }).expect(201);

      expect(response.body.accountConfirmedAt).not.toBeNull();
      expect(response.body.payoutsEnabled).toBe(true);
      expect(response.body.nextStep).toBe('DONE');
    });

    it('rejects a confirmed name the bank never returned', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);
      await pretendResolved();

      await post(venueAdminToken, `${base()}/confirm-account`, {
        confirmedAccountName: 'SOMEBODY ELSE LTD',
      }).expect(400);
    });

    // Otherwise the name check could be passed on one account and the number
    // swapped underneath it.
    it('clears confirmation when the account number changes', async () => {
      await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(201);
      await pretendResolved();
      await post(venueAdminToken, `${base()}/confirm-account`, {
        confirmedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
      }).expect(201);

      const response = await post(venueAdminToken, `${base()}/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '9999999999',
      }).expect(201);

      expect(response.body.accountConfirmedAt).toBeNull();
      expect(response.body.payoutsEnabled).toBe(false);
      expect(response.body.nextStep).toBe('RESOLVE_ACCOUNT');
    });
  });

  describe('access control', () => {
    it('stops a venue admin touching another venue payout account', async () => {
      await get(venueAdminToken, `/venues/${otherVenue.id}/payout-account/status`).expect(403);
      await post(venueAdminToken, `/venues/${otherVenue.id}/payout-account/bank-details`, {
        bankName: 'GTBank',
        accountNumber: '0123456789',
      }).expect(403);
      await post(venueAdminToken, `/venues/${otherVenue.id}/payout-account/confirm-account`, {
        confirmedAccountName: 'ANYTHING',
      }).expect(403);
    });

    it('lets a platform admin act on any venue', async () => {
      await get(platformAdminToken, `/venues/${otherVenue.id}/payout-account/status`).expect(200);
    });

    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get(`${base()}/status`).expect(401);
    });
  });

  describe("the venue's share is reported separately from its entertainers'", () => {
    it('serves own-payouts as its own endpoint', async () => {
      const response = await get(venueAdminToken, `/venues/${venue.id}/own-payouts`).expect(200);

      expect(response.body).toMatchObject({ total: 0, limit: 50, offset: 0, items: [] });
    });

    it('accepts pagination on own-payouts, and none at all', async () => {
      await get(venueAdminToken, `/venues/${venue.id}/own-payouts?limit=5`).expect(200);
      await get(venueAdminToken, `/venues/${venue.id}/own-payouts`).expect(200);
      await get(venueAdminToken, `/venues/${venue.id}/own-payouts?limit=0`).expect(400);
    });

    it("breaks the venue's own balance out in the overview", async () => {
      const response = await get(venueAdminToken, `/venues/${venue.id}/overview`).expect(200);

      expect(response.body).toMatchObject({
        pendingPayoutsKobo: 0,
        ownPendingPayoutsKobo: 0,
        ownPaidOutKobo: 0,
        // False until the flow above is completed, which is why the balance sits still.
        ownPayoutAccountConfirmed: false,
      });
    });

    it('flips ownPayoutAccountConfirmed once the account is confirmed', async () => {
      await prisma.venue.update({
        where: { id: venue.id },
        data: {
          bankName: 'Guaranty Trust Bank',
          bankCode: '058',
          accountNumber: '0123456789',
          resolvedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
          accountResolvedAt: new Date(),
          accountConfirmedAt: new Date(),
        },
      });

      const response = await get(venueAdminToken, `/venues/${venue.id}/overview`).expect(200);

      expect(response.body.ownPayoutAccountConfirmed).toBe(true);
    });

    it('stops a venue admin reading another venue own-payouts', async () => {
      await get(venueAdminToken, `/venues/${otherVenue.id}/own-payouts`).expect(403);
    });
  });
});
