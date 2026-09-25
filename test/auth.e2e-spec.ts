/**
 * E2E tests for authentication (phase-1-production-ready task 20.1).
 *
 * Covers the full request path: validation pipe, login, JWT issuance, and
 * the global guard that protects every other route.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Correct-Horse-Battery-Staple-1';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let throttlerStorage: ThrottlerStorageService;

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
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."users" CASCADE');
    // /auth/login is limited to 5 attempts a minute per IP, and every test
    // here shares one. Clearing the counter keeps each case independent —
    // the limit itself is asserted in security-middleware.e2e-spec.ts.
    throttlerStorage.storage.clear();
  });

  async function createUser(overrides: { email?: string; isActive?: boolean } = {}) {
    return prisma.user.create({
      data: {
        email: overrides.email ?? 'admin@splitcore.dev',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        role: Role.PLATFORM_ADMIN,
        isActive: overrides.isActive ?? true,
      },
    });
  }

  describe('POST /auth/login', () => {
    it('returns a JWT for correct credentials', async () => {
      await createUser();

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: PASSWORD })
        .expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.split('.')).toHaveLength(3);
    });

    it('never returns the password hash', async () => {
      await createUser();

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: PASSWORD });

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('$2');
    });

    it('rejects a wrong password with 401', async () => {
      await createUser();

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: 'wrong-password-entirely' })
        .expect(401);
    });

    it('gives an unknown email the same response as a wrong password', async () => {
      await createUser();

      const unknown = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD });
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: 'wrong-password-entirely' });

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('rejects a deactivated account', async () => {
      await createUser({ isActive: false });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: PASSWORD })
        .expect(401);
    });

    it.each([
      ['a missing password', { email: 'admin@splitcore.dev' }],
      ['a missing email', { password: PASSWORD }],
      ['a malformed email', { email: 'not-an-email', password: PASSWORD }],
    ])('rejects %s with 400', async (_label, body) => {
      await request(app.getHttpServer()).post('/auth/login').send(body).expect(400);
    });

    it('strips unknown properties instead of accepting them', async () => {
      await createUser();

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@splitcore.dev', password: PASSWORD, role: 'PLATFORM_ADMIN' })
        .expect(400);
    });

    it('does not expose a registration endpoint', async () => {
      // Accounts that control payout configuration are provisioned, never
      // self-service.
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'attacker@example.com', password: PASSWORD });

      expect(response.status).toBe(404);
    });
  });

  describe('protected routes', () => {
    async function tokenFor(email = 'admin@splitcore.dev') {
      await createUser({ email });
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD });
      return response.body.accessToken as string;
    }

    it('rejects a request with no token', async () => {
      await request(app.getHttpServer()).get('/venues').expect(401);
    });

    it('rejects a garbage token', async () => {
      await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const forged = new JwtService({ secret: 'a-different-secret-entirely-32-chars' }).sign({
        sub: 'user-1',
        email: 'admin@splitcore.dev',
        role: Role.PLATFORM_ADMIN,
      });

      await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('accepts a valid token', async () => {
      const token = await tokenFor();

      await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('locks out a user deactivated after their token was issued', async () => {
      // The strategy re-reads the database, so revocation is immediate
      // rather than waiting for the token to expire.
      const token = await tokenFor();
      await prisma.user.updateMany({
        where: { email: 'admin@splitcore.dev' },
        data: { isActive: false },
      });

      await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('leaves public routes reachable without a token', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });
});
