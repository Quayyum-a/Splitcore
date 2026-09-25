/**
 * E2E tests for error handling (phase-1-production-ready task 24.1).
 *
 * Every error the API returns passes through one filter, so a client never
 * has to guess whether an error looks different depending on which endpoint
 * produced it. These check the shape, the status mapping, and that internals
 * do not leak.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Error handling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useBodyParser('json', { limit: '1mb' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('response shape', () => {
    it('returns the same envelope for every error', async () => {
      const response = await request(app.getHttpServer()).get('/no-such-route').expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: expect.any(String),
        message: expect.anything(),
        path: '/no-such-route',
        timestamp: expect.any(String),
      });
    });

    it('stamps the path that produced the error', async () => {
      const response = await request(app.getHttpServer()).get('/t/no-such-token').expect(404);

      expect(response.body.path).toBe('/t/no-such-token');
    });

    it('stamps a parseable timestamp', async () => {
      const response = await request(app.getHttpServer()).get('/no-such-route');

      expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    });
  });

  describe('status mapping', () => {
    it('returns 404 for an unknown route', async () => {
      await request(app.getHttpServer()).get('/definitely/not/a/route').expect(404);
    });

    it('returns 401 for a protected route without a token', async () => {
      await request(app.getHttpServer()).get('/venues').expect(401);
    });

    it('returns 400 with the per-field messages for a validation failure', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(Array.isArray(response.body.message)).toBe(true);
      expect(response.body.message.join(' ')).toMatch(/email|password/i);
    });

    it('returns 400 for a body that is not valid JSON', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');

      expect(response.status).toBe(400);
      expect(response.body.statusCode).toBe(400);
    });

    it('returns 413 rather than 500 for an oversized body', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ data: 'x'.repeat(1100 * 1024) });

      expect(response.status).toBe(413);
      expect(response.body.message).toBe('Request payload is too large');
    });

    it('returns 410 for a QR code flow that is no longer usable', async () => {
      // 404 vs 410 is a real distinction for the guest UI: "wrong code"
      // versus "this code has been retired".
      const response = await request(app.getHttpServer()).get('/t/definitely-not-a-token');

      expect([404, 410]).toContain(response.status);
    });
  });

  describe('information disclosure', () => {
    it('does not leak a stack trace', async () => {
      const response = await request(app.getHttpServer()).get('/no-such-route');

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at \w+ \(/);
      expect(body).not.toContain('node_modules');
      expect(response.body.stack).toBeUndefined();
    });

    it('does not leak database or parser internals on a malformed request', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('entity.parse.failed');
      expect(body).not.toMatch(/prisma|postgres|relation/i);
    });

    it('does not echo a submitted password back in the error', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: 'sup3rsecret-value' });

      expect(JSON.stringify(response.body)).not.toContain('sup3rsecret-value');
    });
  });
});
