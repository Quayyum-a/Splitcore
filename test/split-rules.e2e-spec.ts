/**
 * E2E tests for split-rule governance, against real Postgres.
 *
 * Three things have to hold end to end, and none can be proved by unit tests
 * alone because all three are ultimately enforced by the database and the
 * global validation pipe:
 *
 *  1. A venue cannot set the platform's cut. Not by supplying it, not by
 *     omitting it and hoping for a default.
 *  2. A proposal divides nobody's money until the entertainer accepts it.
 *  3. Nothing in the history is ever rewritten - superseded rules stay, and
 *     audit events cannot be edited or deleted at all.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Entertainer, Role, SplitRuleOrigin, SplitRuleStatus, Venue } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/reset-database';

describe('Split Rule Governance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let venue1: Venue;
  let venue2: Venue;
  let entertainer1: Entertainer;
  let unlinkedEntertainer: Entertainer;
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
    await resetDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed();
  });

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

    entertainer1 = await prisma.entertainer.create({
      data: { stageName: 'DJ One', legalName: 'D. One', phone: '+2348000000001' },
    });
    unlinkedEntertainer = await prisma.entertainer.create({
      data: { stageName: 'DJ Elsewhere', legalName: 'D. Else', phone: '+2348000000002' },
    });
    await prisma.venueEntertainer.create({
      data: { venueId: venue1.id, entertainerId: entertainer1.id },
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

    await prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      update: { platformFeeBps: 500 },
      create: { id: 'singleton', platformFeeBps: 500 },
    });
  }

  const server = () => request(app.getHttpServer());
  const propose = (token: string, body: Record<string, unknown>) =>
    server().post('/split-rules').set('Authorization', `Bearer ${token}`).send(body);
  const get = (token: string, path: string) =>
    server().get(path).set('Authorization', `Bearer ${token}`);

  const validProposal = () => ({
    venueId: venue1.id,
    entertainerId: entertainer1.id,
    entertainerBps: 7000,
    venueBps: 2500,
  });

  describe('the platform fee is not a venue decision', () => {
    it('rejects a proposal that carries platformBps at all', async () => {
      await propose(venueAdmin1Token, { ...validProposal(), platformBps: 0 }).expect(400);

      expect(await prisma.splitRule.count()).toBe(0);
    });

    it('stamps the fee from settings, so the venue cannot lower it by omission', async () => {
      const response = await propose(venueAdmin1Token, validProposal()).expect(201);

      expect(response.body.platformBps).toBe(500);
    });

    it('requires the two venue-controlled shares to account for exactly what is left', async () => {
      await propose(venueAdmin1Token, {
        ...validProposal(),
        entertainerBps: 7000,
        venueBps: 3000, // 10000 total, ignores the fee
      }).expect(400);
    });

    it('lets a venue admin read the fee but never write it', async () => {
      await get(venueAdmin1Token, '/platform/settings').expect(200);

      await server()
        .patch('/platform/settings')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send({ platformFeeBps: 0 })
        .expect(403);
    });

    it('lets a platform admin change it, and the next proposal follows the new value', async () => {
      await server()
        .patch('/platform/settings')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ platformFeeBps: 1000 })
        .expect(200);

      // 9500 was valid a moment ago; 9000 is what is splittable now.
      await propose(venueAdmin1Token, validProposal()).expect(400);
      const ok = await propose(venueAdmin1Token, {
        ...validProposal(),
        entertainerBps: 6500,
        venueBps: 2500,
      }).expect(201);

      expect(ok.body.platformBps).toBe(1000);
    });
  });

  describe('a proposal does not divide money until the entertainer accepts', () => {
    it('creates the rule PENDING and keeps it out of the active lookup', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      expect(created.body.status).toBe(SplitRuleStatus.PENDING_ENTERTAINER_APPROVAL);
      expect(created.body.effectiveFrom).toBeNull();

      await get(venueAdmin1Token, `/split-rules/venue/${venue1.id}/active`).expect(404);
    });

    it('returns a consent link, and the raw token is never stored', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      expect(created.body.consentUrl).toContain(
        `/split-rules/${created.body.id}/respond/${created.body.consentToken}`,
      );

      const stored = await prisma.splitRule.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(stored.responseTokenHash).not.toBe(created.body.consentToken);
    });

    it('shows the terms as plain percentages with no login', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      const terms = await server()
        .get(`/split-rules/${created.body.id}/respond/${created.body.consentToken}`)
        .expect(200);

      expect(terms.body).toMatchObject({
        venueName: 'Venue One',
        entertainerName: 'DJ One',
        entertainerPercentage: 70,
        venuePercentage: 25,
        platformPercentage: 5,
      });
    });

    it('activates the rule on ACCEPT, with no login', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      await server()
        .post(`/split-rules/${created.body.id}/respond/${created.body.consentToken}`)
        .send({ decision: 'ACCEPT' })
        .expect(201);

      const active = await get(venueAdmin1Token, `/split-rules/venue/${venue1.id}/active`).expect(
        200,
      );
      expect(active.body.id).toBe(created.body.id);
      expect(active.body.status).toBe(SplitRuleStatus.ACTIVE);
      expect(active.body.effectiveFrom).not.toBeNull();
    });

    it('never activates on REJECT', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      await server()
        .post(`/split-rules/${created.body.id}/respond/${created.body.consentToken}`)
        .send({ decision: 'REJECT' })
        .expect(201);

      await get(venueAdmin1Token, `/split-rules/venue/${venue1.id}/active`).expect(404);
      const stored = await prisma.splitRule.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.status).toBe(SplitRuleStatus.REJECTED);
      expect(stored.effectiveFrom).toBeNull();
    });

    it('spends the token, so the same link cannot be used twice', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);
      const url = `/split-rules/${created.body.id}/respond/${created.body.consentToken}`;

      await server().post(url).send({ decision: 'ACCEPT' }).expect(201);
      await server().post(url).send({ decision: 'REJECT' }).expect(404);

      const stored = await prisma.splitRule.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.status).toBe(SplitRuleStatus.ACTIVE);
    });

    it('rejects a forged token', async () => {
      const created = await propose(venueAdmin1Token, validProposal()).expect(201);

      await server()
        .post(`/split-rules/${created.body.id}/respond/${'0'.repeat(64)}`)
        .send({ decision: 'ACCEPT' })
        .expect(404);
    });

    it('refuses to propose terms to an entertainer who does not work there', async () => {
      await propose(venueAdmin1Token, {
        ...validProposal(),
        entertainerId: unlinkedEntertainer.id,
      }).expect(400);
    });

    it('withdraws an earlier unanswered proposal so two links cannot disagree', async () => {
      const first = await propose(venueAdmin1Token, validProposal()).expect(201);
      await propose(venueAdmin1Token, {
        ...validProposal(),
        entertainerBps: 6000,
        venueBps: 3500,
      }).expect(201);

      const stale = await prisma.splitRule.findUniqueOrThrow({ where: { id: first.body.id } });
      expect(stale.status).toBe(SplitRuleStatus.WITHDRAWN);

      await server()
        .post(`/split-rules/${first.body.id}/respond/${first.body.consentToken}`)
        .send({ decision: 'ACCEPT' })
        .expect(404);
    });
  });

  describe('history is append-only', () => {
    async function activate(shares: { entertainerBps: number; venueBps: number }) {
      const created = await propose(venueAdmin1Token, { ...validProposal(), ...shares }).expect(
        201,
      );
      await server()
        .post(`/split-rules/${created.body.id}/respond/${created.body.consentToken}`)
        .send({ decision: 'ACCEPT' })
        .expect(201);
      return created.body.id as string;
    }

    it('supersedes the outgoing rule instead of deleting it, leaving exactly one active', async () => {
      const firstId = await activate({ entertainerBps: 7000, venueBps: 2500 });
      const secondId = await activate({ entertainerBps: 6000, venueBps: 3500 });

      const first = await prisma.splitRule.findUniqueOrThrow({ where: { id: firstId } });
      expect(first.status).toBe(SplitRuleStatus.SUPERSEDED);
      expect(first.effectiveTo).not.toBeNull();

      const active = await prisma.splitRule.findMany({
        where: { venueId: venue1.id, status: SplitRuleStatus.ACTIVE, effectiveTo: null },
      });
      expect(active.map((r) => r.id)).toEqual([secondId]);
    });

    it('records who proposed and who accepted', async () => {
      const id = await activate({ entertainerBps: 7000, venueBps: 2500 });

      const trail = await get(venueAdmin1Token, `/split-rules/${id}/audit`).expect(200);
      const events = trail.body.map((e: { event: string }) => e.event);
      expect(events).toEqual(['PROPOSED', 'ACCEPTED']);
      expect(trail.body[0].actorType).toBe('VENUE_ADMIN');
      expect(trail.body[1].actorType).toBe('ENTERTAINER');
    });

    // The database refuses, not the application. An audit trail the app could
    // rewrite is not an audit trail.
    it('will not let an audit event be edited or deleted', async () => {
      const id = await activate({ entertainerBps: 7000, venueBps: 2500 });
      const event = await prisma.splitRuleAuditEvent.findFirstOrThrow({
        where: { splitRuleId: id },
      });

      await expect(
        prisma.splitRuleAuditEvent.update({
          where: { id: event.id },
          data: { event: 'TAMPERED' },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.splitRuleAuditEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();
    });
  });

  describe('platform admin override', () => {
    const override = (body: Record<string, unknown>) =>
      server()
        .post('/split-rules/override')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(body);

    it('takes effect at once and is marked ADMIN_OVERRIDE, not a mutual agreement', async () => {
      const response = await override({
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
        reason: 'Dispute resolution ticket SC-1042',
      }).expect(201);

      expect(response.body.status).toBe(SplitRuleStatus.ACTIVE);
      expect(response.body.origin).toBe(SplitRuleOrigin.ADMIN_OVERRIDE);
      expect(response.body.entertainerId).toBeNull();
      expect(response.body.effectiveFrom).not.toBeNull();
    });

    it('writes the reason to the audit trail', async () => {
      const response = await override({
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
        reason: 'Dispute resolution ticket SC-1042',
      }).expect(201);

      const trail = await get(platformAdminToken, `/split-rules/${response.body.id}/audit`).expect(
        200,
      );
      expect(trail.body[0].event).toBe('ADMIN_OVERRIDE');
      expect(trail.body[0].detail.reason).toBe('Dispute resolution ticket SC-1042');
    });

    it('still requires all three shares to total 10000', async () => {
      await override({
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 1000,
        reason: 'Dispute resolution ticket SC-1042',
      }).expect(400);
    });

    it('requires a reason', async () => {
      await override({
        venueId: venue1.id,
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      }).expect(400);
    });

    it('is closed to venue admins', async () => {
      await server()
        .post('/split-rules/override')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send({
          venueId: venue1.id,
          entertainerBps: 9500,
          venueBps: 500,
          platformBps: 0,
          reason: 'Trying it on',
        })
        .expect(403);
    });
  });

  describe('access control', () => {
    it('rejects an unauthenticated proposal', async () => {
      await server().post('/split-rules').send(validProposal()).expect(401);
    });

    it('stops a venue admin proposing for another venue', async () => {
      await propose(venueAdmin1Token, { ...validProposal(), venueId: venue2.id }).expect(403);
    });

    it('stops a venue admin reading another venue history', async () => {
      await get(venueAdmin1Token, `/split-rules/venue/${venue2.id}`).expect(403);
    });
  });
});
