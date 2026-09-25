/**
 * E2E tests for split rules (phase-2-core-domain task 10.5).
 *
 * A split rule decides how every tip at a venue is divided, so the two rules
 * that matter are asserted end to end: the shares must sum to exactly
 * 100.00%, and a venue admin must never be able to touch another venue's
 * configuration.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Role, Venue } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Split Rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let venue1: Venue;
  let venue2: Venue;
  let platformAdminToken: string;
  let venueAdmin1Token: string;

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
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seed();
  });

  async function cleanDatabase() {
    await prisma.splitRule.deleteMany();
    await prisma.user.deleteMany();
    await prisma.venue.deleteMany();
  }

  function tokenFor(user: { id: string; email: string; role: Role }) {
    return jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }

  async function seed() {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    venue1 = await prisma.venue.create({
      data: { name: 'Venue One', slug: 'venue-one', location: 'Lagos' },
    });
    venue2 = await prisma.venue.create({
      data: { name: 'Venue Two', slug: 'venue-two', location: 'Abuja' },
    });

    platformAdminToken = tokenFor(
      await prisma.user.create({
        data: { email: 'platform@splitcore.dev', passwordHash, role: Role.PLATFORM_ADMIN },
      }),
    );
    venueAdmin1Token = tokenFor(
      await prisma.user.create({
        data: {
          email: 'venue1@splitcore.dev',
          passwordHash,
          role: Role.VENUE_ADMIN,
          venueId: venue1.id,
        },
      }),
    );
  }

  const post = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/split-rules')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  describe('POST /split-rules', () => {
    it('creates a rule whose shares sum to 10000 basis points', async () => {
      const response = await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      }).expect(201);

      expect(response.body).toMatchObject({
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      });
      expect(response.body.effectiveTo).toBeNull();
    });

    it.each([
      ['under 100%', { entertainerBps: 8000, venueBps: 1000, platformBps: 500 }],
      ['over 100%', { entertainerBps: 9000, venueBps: 1000, platformBps: 500 }],
      ['all zero', { entertainerBps: 0, venueBps: 0, platformBps: 0 }],
    ])('rejects shares that sum %s', async (_label, shares) => {
      await post(platformAdminToken, { venueId: venue1.id, ...shares }).expect(400);

      expect(await prisma.splitRule.count()).toBe(0);
    });

    it('rejects a negative share', async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 11000,
        venueBps: -1000,
        platformBps: 0,
      }).expect(400);
    });

    it('rejects a fractional basis point', async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500.5,
        venueBps: 999.5,
        platformBps: 500,
      }).expect(400);
    });

    it('rejects a request with no venue', async () => {
      await post(platformAdminToken, {
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      }).expect(400);
    });

    it('allows a zero platform share, as long as the total is exact', async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 9000,
        venueBps: 1000,
        platformBps: 0,
      }).expect(201);
    });

    it('closes out the previous rule instead of leaving two active', async () => {
      // Two active rules would make "the rule in force" ambiguous, and
      // settlement divides money by exactly one of them.
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      }).expect(201);

      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      }).expect(201);

      const active = await prisma.splitRule.findMany({
        where: { venueId: venue1.id, effectiveTo: null },
      });
      expect(active).toHaveLength(1);
      expect(active[0].entertainerBps).toBe(7000);
    });

    it('keeps the superseded rule as history rather than deleting it', async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      });
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      });

      const all = await prisma.splitRule.findMany({ where: { venueId: venue1.id } });
      expect(all).toHaveLength(2);
      expect(all.filter((rule) => rule.effectiveTo !== null)).toHaveLength(1);
    });
  });

  describe('GET /split-rules/venue/:venueId', () => {
    beforeEach(async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      });
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      });
    });

    it('returns the venue history newest first', async () => {
      const response = await get(platformAdminToken, `/split-rules/venue/${venue1.id}`).expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].entertainerBps).toBe(7000);
    });

    it('returns an empty list for a venue with no rules', async () => {
      const response = await get(platformAdminToken, `/split-rules/venue/${venue2.id}`).expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /split-rules/venue/:venueId/active', () => {
    it('returns the rule currently in force', async () => {
      await post(platformAdminToken, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      });

      const response = await get(
        platformAdminToken,
        `/split-rules/venue/${venue1.id}/active`,
      ).expect(200);

      expect(response.body.entertainerBps).toBe(8500);
      expect(response.body.effectiveTo).toBeNull();
    });

    it('returns 404 when a venue has no active rule', async () => {
      // This is what blocks payment initialization for that venue.
      await get(platformAdminToken, `/split-rules/venue/${venue2.id}/active`).expect(404);
    });
  });

  describe('access control', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get(`/split-rules/venue/${venue1.id}/active`).expect(401);
    });

    it('lets a venue admin manage their own venue', async () => {
      await post(venueAdmin1Token, {
        venueId: venue1.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      }).expect(201);
    });

    it('stops a venue admin creating a rule for another venue', async () => {
      await post(venueAdmin1Token, {
        venueId: venue2.id,
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
      }).expect(403);

      expect(await prisma.splitRule.count({ where: { venueId: venue2.id } })).toBe(0);
    });

    it('stops a venue admin reading another venue’s rules', async () => {
      await get(venueAdmin1Token, `/split-rules/venue/${venue2.id}`).expect(403);
      await get(venueAdmin1Token, `/split-rules/venue/${venue2.id}/active`).expect(403);
    });
  });
});
