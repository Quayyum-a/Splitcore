/**
 * E2E tests for running with no Redis at all (REDIS_ENABLED=false).
 *
 * This is the mode that keeps the API deployable while a Redis provider is
 * over quota or unavailable. What has to hold: the app boots and serves
 * HTTP, nothing opens a Redis socket, and webhook events still get
 * processed — inline, since there is no worker to hand them to.
 */

// Set BEFORE importing anything that reads it: QueueModule decides its shape
// at module-definition time, which happens on import. Jest gives each spec
// file its own module registry but not its own process, so the original
// value is restored in afterAll for whatever file runs next.
const PREVIOUS_REDIS_ENABLED = process.env.REDIS_ENABLED;
process.env.REDIS_ENABLED = 'false';

import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as crypto from 'crypto';

describe('Running without Redis (e2e)', () => {
  let app: INestApplication;
  let prisma: any;

  beforeAll(async () => {
    // Dynamic import so the env var above is already in place.
    const { AppModule } = await import('../src/app.module');
    const { PrismaService } = await import('../src/prisma/prisma.service');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
    if (PREVIOUS_REDIS_ENABLED === undefined) {
      delete process.env.REDIS_ENABLED;
    } else {
      process.env.REDIS_ENABLED = PREVIOUS_REDIS_ENABLED;
    }
  });

  it('boots and serves HTTP', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('reports healthy without a Redis indicator', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.info.database.status).toBe('up');
    expect(response.body.info.redis).toBeUndefined();
  });

  it('injects a null Redis client rather than a broken one', async () => {
    const { REDIS_CLIENT } = await import('../src/redis/redis.module');

    expect(app.get(REDIS_CLIENT, { strict: false })).toBeNull();
  });

  it('reports the Redis service as disabled, not merely unready', async () => {
    const { RedisService } = await import('../src/redis/redis.service');
    const redisService = app.get(RedisService, { strict: false });

    expect(redisService.isEnabled()).toBe(false);
    expect(redisService.isReady()).toBe(false);
    expect(redisService.getClient()).toBeNull();
  });

  it('substitutes a stub for every queue', async () => {
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { NullQueue } = await import('../src/queue/null-queue');
    const { QUEUE_NAMES } = await import('../src/queue/queue.module');

    for (const name of QUEUE_NAMES) {
      expect(app.get(getQueueToken(name), { strict: false })).toBeInstanceOf(NullQueue);
    }
  });

  it('still rejects an unsigned webhook', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .send({ event: 'charge.success', data: { id: 1, reference: 'pay_x' } })
      .expect(401);
  });

  it('accepts a signed webhook and processes it inline', async () => {
    // No worker exists in this mode, so ingest must do the work itself —
    // otherwise the event is stored and the payment silently never settles.
    const payload = {
      event: 'charge.success',
      data: { id: 90210, reference: 'pay_no_such_reference' },
    };
    const raw = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(raw)
      .digest('hex');

    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(raw)
      .expect(200);

    const event = await prisma.webhookEvent.findUnique({
      where: { externalEventId: 'paystack:charge.success:90210' },
    });
    expect(event).not.toBeNull();
    // Settlement found no payment for that reference, so there was nothing
    // to do — but the event was handled, not left PENDING for a worker.
    expect(event.processingStatus).toBe('COMPLETED');
    expect(event.processedAt).not.toBeNull();
  });

  it('serves the payment callback page', async () => {
    const response = await request(app.getHttpServer())
      .get('/payments/callback')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(response.text).toContain('No payment reference was supplied');
  });
});
