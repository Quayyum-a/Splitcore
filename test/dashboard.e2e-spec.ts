/**
 * E2E tests for the dashboard read endpoints.
 *
 * These exist because unit tests could not have caught the bug they were written
 * for. The paginated handlers used `@Query('limit', new ParseIntPipe({ optional:
 * true }))`, which looked correct and shipped broken: alongside the global
 * ValidationPipe, `optional` was not honoured, so omitting limit/offset answered
 * 400 and the history endpoints were uncallable without both. A unit test that
 * invokes the controller method directly passes `undefined` straight in and never
 * touches a pipe. Only a real request does.
 *
 * So the first thing asserted here is the boring case: no query string at all.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Entertainer, Role, Venue } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/reset-database';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let venue: Venue;
  let otherVenue: Venue;
  let entertainer: Entertainer;
  let platformAdminToken: string;
  let venueAdminToken: string;
  let entertainerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Exactly the pipe configuration AppModule registers, because the bug this
    // file exists for lived in the interaction with it.
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
      data: { name: 'Quilox', slug: 'quilox-dash', location: 'Lagos' },
    });
    otherVenue = await prisma.venue.create({
      data: { name: 'Cubana', slug: 'cubana-dash', location: 'Abuja' },
    });
    entertainer = await prisma.entertainer.create({
      data: { stageName: 'DJ Neptune', legalName: 'Patrick I', phone: '+2348011111111' },
    });
    await prisma.venueEntertainer.create({
      data: { venueId: venue.id, entertainerId: entertainer.id },
    });

    platformAdminToken = tokenFor(
      await prisma.user.create({
        data: { email: 'platform@splitcore.dev', passwordHash, role: Role.PLATFORM_ADMIN },
      }),
    );
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
    entertainerToken = jwtService.sign({
      sub: entertainer.id,
      email: '',
      role: Role.ENTERTAINER,
      entertainerId: entertainer.id,
    });
  }

  function tokenFor(user: { id: string; email: string; role: Role }) {
    return jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }

  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  describe('pagination through the real pipes', () => {
    const paginated = () => [
      `/venues/${venue.id}/transactions`,
      `/venues/${venue.id}/payouts`,
      `/entertainers/${entertainer.id}/transactions`,
      `/entertainers/${entertainer.id}/payouts`,
    ];

    // The regression. Every one of these answered 400 before the fix.
    it('accepts a request with no query string at all', async () => {
      for (const path of paginated()) {
        const response = await get(platformAdminToken, path);
        expect([path, response.status]).toEqual([path, 200]);
        expect(response.body).toMatchObject({ total: 0, limit: 50, offset: 0, items: [] });
      }
    });

    it('accepts explicit limit and offset', async () => {
      for (const path of paginated()) {
        const response = await get(platformAdminToken, `${path}?limit=5&offset=0`).expect(200);
        expect(response.body.limit).toBe(5);
      }
    });

    it('accepts limit alone and offset alone', async () => {
      await get(platformAdminToken, `/venues/${venue.id}/transactions?limit=10`).expect(200);
      await get(platformAdminToken, `/venues/${venue.id}/transactions?offset=10`).expect(200);
    });

    it.each([
      ['a non-numeric limit', 'limit=abc'],
      ['a limit over the maximum', 'limit=5000'],
      ['a zero limit', 'limit=0'],
      ['a negative offset', 'offset=-1'],
      ['an unknown parameter', 'sortBy=amount'],
    ])('rejects %s with 400', async (_label, query) => {
      await get(platformAdminToken, `/venues/${venue.id}/transactions?${query}`).expect(400);
    });
  });

  describe('venue overview', () => {
    it('reports zeroes for a venue with no activity, rather than failing', async () => {
      const response = await get(venueAdminToken, `/venues/${venue.id}/overview`).expect(200);

      expect(response.body).toMatchObject({
        venueId: venue.id,
        venueName: 'Quilox',
        totalTipsKobo: 0,
        transactionCount: 0,
        entertainerCount: 1,
        pendingPayoutsKobo: 0,
      });
    });

    it('windows to the Lagos calendar day', async () => {
      const response = await get(venueAdminToken, `/venues/${venue.id}/overview`).expect(200);

      // 23:00 UTC is midnight in Lagos.
      expect(new Date(response.body.windowFrom).getUTCHours()).toBe(23);
    });

    it('lists linked entertainers with zeroed earnings', async () => {
      const response = await get(
        venueAdminToken,
        `/venues/${venue.id}/entertainer-earnings`,
      ).expect(200);

      expect(response.body).toEqual([
        {
          entertainerId: entertainer.id,
          stageName: 'DJ Neptune',
          tonightKobo: 0,
          thisWeekKobo: 0,
          totalKobo: 0,
        },
      ]);
    });

    it('404s for an unknown venue', async () => {
      await get(platformAdminToken, '/venues/11111111-1111-1111-1111-111111111111/overview').expect(
        404,
      );
    });
  });

  describe('entertainer overview', () => {
    it('reports zeroes before anyone has tipped them', async () => {
      const response = await get(
        entertainerToken,
        `/entertainers/${entertainer.id}/overview`,
      ).expect(200);

      expect(response.body).toMatchObject({
        entertainerId: entertainer.id,
        stageName: 'DJ Neptune',
        tonightKobo: 0,
        totalKobo: 0,
        pendingPayoutsKobo: 0,
        paidOutKobo: 0,
      });
    });
  });

  describe('access control', () => {
    it('stops a venue admin reading another venue', async () => {
      await get(venueAdminToken, `/venues/${otherVenue.id}/overview`).expect(403);
    });

    // The guarantee the entertainer dashboard rests on.
    it("stops an entertainer reading another entertainer's data", async () => {
      const other = await prisma.entertainer.create({
        data: { stageName: 'DJ Other', legalName: 'Other P', phone: '+2348022222222' },
      });

      await get(entertainerToken, `/entertainers/${other.id}/overview`).expect(403);
      await get(entertainerToken, `/entertainers/${other.id}/transactions`).expect(403);
      await get(entertainerToken, `/entertainers/${other.id}/payouts`).expect(403);
    });

    it('gives an entertainer no route to venue-wide figures', async () => {
      await get(entertainerToken, `/venues/${venue.id}/overview`).expect(403);
      await get(entertainerToken, `/venues/${venue.id}/payouts`).expect(403);
    });

    it('stops a venue admin reading an entertainer who performs elsewhere', async () => {
      const elsewhere = await prisma.entertainer.create({
        data: { stageName: 'DJ Elsewhere', legalName: 'Else P', phone: '+2348033333333' },
      });

      await get(venueAdminToken, `/entertainers/${elsewhere.id}/overview`).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get(`/venues/${venue.id}/overview`).expect(401);
    });
  });
});
