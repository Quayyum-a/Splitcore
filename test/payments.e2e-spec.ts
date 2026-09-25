import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaystackProvider } from '../src/payments/providers/paystack.provider';
import { PaystackPayoutProvider } from '../src/payments/providers/paystack-payout.provider';
import { PaymentSettlementService } from '../src/payments/payment-settlement.service';
import { WebhookEventHandler } from '../src/webhooks/webhook-event-handler.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { LedgerRepository } from '../src/ledger/ledger.repository';
import { ReconciliationModule } from '../src/reconciliation/reconciliation.module';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import {
  DIAGNOSTICS_QUEUE,
  PAYOUTS_QUEUE,
  RECONCILIATION_QUEUE,
  WEBHOOKS_QUEUE,
} from '../src/queue/queue.module';
import { RedisService } from '../src/redis/redis.service';
import { PaymentVerification } from '../src/payments/interfaces';

/**
 * Phase 3 money flow against a real Postgres (real constraints, real
 * triggers). Only the processor's HTTP API and Redis are faked:
 * - Paystack HTTP calls are stubbed; webhook signatures use real HMAC.
 * - Queues are fakes; tests drive the worker-side services directly.
 */
const SECRET = 'sk_test_e2e_secret';
const sign = (body: string) => crypto.createHmac('sha512', SECRET).update(body).digest('hex');

describe('Payments, ledger, webhooks, payouts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settlement: PaymentSettlementService;
  let webhookHandler: WebhookEventHandler;
  let payouts: PayoutsService;
  let ledgerRepo: LedgerRepository;
  let reconciliation: ReconciliationService;

  const paystack = new PaystackProvider({
    get: (key: string) => ({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_PUBLIC_KEY: 'pk_test' })[key],
  } as unknown as ConfigService);
  const paystackPayout = new PaystackPayoutProvider({
    get: (key: string) => ({ PAYSTACK_SECRET_KEY: SECRET })[key],
  } as unknown as ConfigService);

  const webhooksQueue = { add: jest.fn() };
  const payoutsQueue = { add: jest.fn() };

  let venue: { id: string };
  let entertainer: { id: string };
  let sessionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ReconciliationModule],
    })
      .overrideProvider(PaystackProvider)
      .useValue(paystack)
      .overrideProvider(PaystackPayoutProvider)
      .useValue(paystackPayout)
      .overrideProvider(getQueueToken(WEBHOOKS_QUEUE))
      .useValue(webhooksQueue)
      .overrideProvider(getQueueToken(PAYOUTS_QUEUE))
      .useValue(payoutsQueue)
      // This suite is about money, not Redis: the global e2e setup points
      // Redis at an unreachable host, so stub everything that would connect.
      .overrideProvider(getQueueToken(DIAGNOSTICS_QUEUE))
      .useValue({ add: jest.fn() })
      .overrideProvider(getQueueToken(RECONCILIATION_QUEUE))
      .useValue({ add: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({ isReady: () => false, ping: async () => false, getClient: () => undefined })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    prisma = app.get(PrismaService);
    settlement = app.get(PaymentSettlementService);
    webhookHandler = app.get(WebhookEventHandler);
    payouts = app.get(PayoutsService);
    ledgerRepo = app.get(LedgerRepository);
    reconciliation = app.get(ReconciliationService);
  });

  afterAll(async () => {
    await truncateAll();
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    webhooksQueue.add.mockReset().mockResolvedValue({});
    payoutsQueue.add.mockReset().mockResolvedValue({});
    jest.spyOn(paystack, 'initializePayment').mockImplementation(async (params) => ({
      authorizationUrl: `https://checkout.paystack.test/${params.reference}`,
      accessCode: 'ac_test',
      reference: params.reference,
    }));
    await truncateAll();
    await seed();
  });

  async function truncateAll() {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "payouts", "ledger_entries", "ledger_accounts", "webhook_events",
        "payment_transactions", "guest_sessions", "qr_codes", "split_rules",
        "venue_entertainers", "entertainers", "users", "venues" CASCADE`);
  }

  async function seed(kycStatus: 'VERIFIED' | 'PENDING' = 'VERIFIED') {
    venue = await prisma.venue.create({
      data: { name: 'Quilox', slug: `quilox-${Date.now()}`, location: 'Lagos' },
    });
    entertainer = await prisma.entertainer.create({
      data: {
        stageName: 'DJ Test',
        legalName: 'Test Person',
        phone: `+23480${Date.now().toString().slice(-8)}`,
        bankName: 'GTBank',
        accountNumber: '0123456789',
        kycStatus,
      },
    });
    const qr = await prisma.qrCode.create({
      data: {
        publicToken: `tok_${Date.now()}`,
        venueId: venue.id,
        entertainerId: entertainer.id,
        location: 'Main stage',
      },
    });
    const session = await prisma.guestSession.create({
      data: { qrCodeId: qr.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    sessionId = session.id;
  }

  async function addSplitRule(entertainerBps = 8500, venueBps = 1000, platformBps = 500) {
    await prisma.splitRule.updateMany({
      where: { venueId: venue.id, effectiveTo: null },
      data: { effectiveTo: new Date() },
    });
    return prisma.splitRule.create({
      data: { venueId: venue.id, entertainerBps, venueBps, platformBps },
    });
  }

  async function initialize(amountKobo = 500000): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/payments/initialize')
      .send({ sessionId, amountKobo })
      .expect(200);
    return res.body.reference;
  }

  function providerSays(
    reference: string,
    status: PaymentVerification['status'],
    amountKobo = 500000,
    currency = 'NGN',
  ) {
    return jest
      .spyOn(paystack, 'verifyPayment')
      .mockResolvedValue({ reference, status, amountKobo, currency });
  }

  function sendWebhook(payload: object, signature?: string) {
    const body = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature ?? sign(body))
      .send(body);
  }

  const chargeSuccess = (reference: string) => ({
    event: 'charge.success',
    data: { id: 302961, reference, amount: 500000, currency: 'NGN', status: 'success' },
  });

  /** Simulate the worker picking up every webhook job the API enqueued. */
  async function drainWebhookJobs() {
    for (const [, data] of webhooksQueue.add.mock.calls) {
      await webhookHandler.handle(data.webhookEventId);
    }
  }

  async function ledgerFor(transactionId: string) {
    return prisma.ledgerEntry.findMany({
      where: { transactionId },
      include: { account: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  const entertainerBalance = () => ledgerRepo.getBalance('ENTERTAINER_PAYABLE', entertainer.id);

  async function settledPaymentWithEntertainerPayout() {
    await addSplitRule();
    const reference = await initialize();
    providerSays(reference, 'success');
    await settlement.settle(reference);
    const payment = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { externalReference: reference },
    });
    const payout = await prisma.payout.findFirstOrThrow({
      where: { transactionId: payment.id, ledgerAccount: { type: 'ENTERTAINER_PAYABLE' } },
    });
    return { reference, payment, payout };
  }

  // ---------------------------------------------------------------- initialize

  describe('initialization', () => {
    it('rejects the payment outright when the venue has no active split rule', async () => {
      await request(app.getHttpServer())
        .post('/payments/initialize')
        .send({ sessionId, amountKobo: 500000 })
        .expect(400);

      expect(await prisma.paymentTransaction.count()).toBe(0);
      expect(paystack.initializePayment).not.toHaveBeenCalled();
    });

    it('creates a CREATED payment with our own reference and the split rule snapshotted', async () => {
      const rule = await addSplitRule();
      const reference = await initialize();

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(reference).toMatch(/^pay_/);
      expect(payment).toMatchObject({
        status: 'CREATED',
        provider: 'paystack',
        splitRuleId: rule.id,
      });
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('rejects reuse of an external reference at the database level', async () => {
      await addSplitRule();
      const reference = await initialize();
      const existing = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });

      const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = existing;
      await expect(prisma.paymentTransaction.create({ data: copy })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  // ---------------------------------------------------------------- webhooks

  describe('webhook → settlement → ledger', () => {
    it('posts the balanced worked-example entries and queues payouts for a verified charge', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'success');

      await sendWebhook(chargeSuccess(reference)).expect(200);
      expect(webhooksQueue.add).toHaveBeenCalledTimes(1);

      // Acknowledged but not yet processed: nothing posted.
      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(payment.status).toBe('CREATED');
      expect(await ledgerFor(payment.id)).toHaveLength(0);

      await drainWebhookJobs();

      const settled = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(settled.status).toBe('SUCCESS');

      const entries = await ledgerFor(payment.id);
      expect(entries.map((e) => [e.account.type, e.direction, e.amountKobo]).sort()).toEqual(
        [
          ['PROCESSOR_CLEARING', 'DEBIT', 500000],
          ['ENTERTAINER_PAYABLE', 'CREDIT', 425000],
          ['VENUE_PAYABLE', 'CREDIT', 50000],
          ['PLATFORM_REVENUE', 'CREDIT', 25000],
        ].sort(),
      );

      const payoutRows = await prisma.payout.findMany({ where: { transactionId: payment.id } });
      expect(payoutRows.map((p) => p.amountKobo).sort()).toEqual([425000, 50000].sort());
      expect(payoutsQueue.add).toHaveBeenCalledTimes(2);

      const event = await prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({
        processingStatus: 'COMPLETED',
        externalEventId: 'paystack:charge.success:302961',
      });
    });

    it('duplicate webhooks are harmless: one event row, one set of entries, one set of payouts', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'success');

      // Paystack retries, including concurrently.
      await Promise.all([1, 2, 3].map(() => sendWebhook(chargeSuccess(reference)).expect(200)));
      await sendWebhook(chargeSuccess(reference)).expect(200);
      await drainWebhookJobs();
      await drainWebhookJobs();

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(await prisma.webhookEvent.count()).toBe(1);
      expect(await ledgerFor(payment.id)).toHaveLength(4);
      expect(await prisma.payout.count({ where: { transactionId: payment.id } })).toBe(2);
      expect(await entertainerBalance()).toBe(425000);
    });

    it('concurrent settlement attempts (webhook + polls) post exactly once', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'success');

      await Promise.all(Array.from({ length: 8 }, () => settlement.settle(reference)));

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(await ledgerFor(payment.id)).toHaveLength(4);
      expect(await entertainerBalance()).toBe(425000);
    });

    it('rejects a bad signature without storing anything', async () => {
      await addSplitRule();
      const reference = await initialize();

      await sendWebhook(chargeSuccess(reference), sign('something else')).expect(401);
      await sendWebhook(chargeSuccess(reference), 'garbage').expect(401);

      expect(await prisma.webhookEvent.count()).toBe(0);
      expect(webhooksQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues a stored event on retry if the first enqueue failed (Redis down)', async () => {
      await addSplitRule();
      const reference = await initialize();
      webhooksQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

      await sendWebhook(chargeSuccess(reference)).expect(500); // Paystack will retry
      expect(await prisma.webhookEvent.count()).toBe(1);

      await sendWebhook(chargeSuccess(reference)).expect(200);
      expect(webhooksQueue.add).toHaveBeenCalledTimes(2);
      expect(await prisma.webhookEvent.count()).toBe(1);
    });

    it('never settles on a webhook the provider does not confirm', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'pending');

      await sendWebhook(chargeSuccess(reference)).expect(200);
      await drainWebhookJobs();

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(payment.status).toBe('PENDING');
      expect(await ledgerFor(payment.id)).toHaveLength(0);
    });

    it('does not settle, or mark FAILED, when the provider reports a different amount', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'success', 100);

      await sendWebhook(chargeSuccess(reference)).expect(200);
      await drainWebhookJobs();

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      expect(payment.status).toBe('CREATED');
      expect(await ledgerFor(payment.id)).toHaveLength(0);
      expect((await prisma.webhookEvent.findFirstOrThrow()).processingStatus).toBe('FAILED');
    });

    it('divides by the split quoted at initialization, even if the venue changes it mid-payment', async () => {
      await addSplitRule(8500, 1000, 500);
      const reference = await initialize();
      await addSplitRule(7000, 2000, 1000); // venue edits split before the webhook lands
      providerSays(reference, 'success');

      await settlement.settle(reference);

      expect(await entertainerBalance()).toBe(425000);
    });
  });

  // ------------------------------------------------------------- status poll

  describe('GET /payments/:reference/status (fallback)', () => {
    it('shows PENDING while the provider has not confirmed, regardless of any redirect', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'abandoned');

      const res = await request(app.getHttpServer())
        .get(`/payments/${reference}/status`)
        .expect(200);

      expect(res.body.status).toBe('PENDING');
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('settles through the same path as the webhook, and the late webhook then posts nothing', async () => {
      await addSplitRule();
      const reference = await initialize();
      providerSays(reference, 'success');

      const res = await request(app.getHttpServer())
        .get(`/payments/${reference}/status`)
        .expect(200);
      expect(res.body.status).toBe('SUCCESS');

      const payment = await prisma.paymentTransaction.findUniqueOrThrow({
        where: { externalReference: reference },
      });
      // A SUCCESS status must never exist without its ledger entries.
      expect(await ledgerFor(payment.id)).toHaveLength(4);

      await sendWebhook(chargeSuccess(reference)).expect(200);
      await drainWebhookJobs();
      expect(await ledgerFor(payment.id)).toHaveLength(4);
    });
  });

  // ------------------------------------------------------------------ payouts

  describe('payouts', () => {
    beforeEach(() => {
      jest.spyOn(paystackPayout, 'createRecipient').mockResolvedValue({
        recipientCode: 'RCP_test',
        active: true,
      });
    });

    it('pays out a verified entertainer and debits the payable balance only on success', async () => {
      const { payout } = await settledPaymentWithEntertainerPayout();
      const transfer = jest.spyOn(paystackPayout, 'initiateTransfer').mockResolvedValue({
        reference: 'x',
        status: 'success',
        amountKobo: 425000,
        createdAt: new Date(),
      });

      await payouts.processPayout(payout.id);

      expect(transfer).toHaveBeenCalledTimes(1);
      expect(transfer.mock.calls[0][0]).toMatchObject({ amountKobo: 425000 });
      expect(await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
        status: 'SUCCESS',
        attempts: 1,
      });
      expect(await entertainerBalance()).toBe(0);
    });

    it('holds payouts for an unverified entertainer while the ledger still accrues', async () => {
      await prisma.entertainer.update({
        where: { id: entertainer.id },
        data: { kycStatus: 'PENDING' },
      });
      const { payout } = await settledPaymentWithEntertainerPayout();
      const transfer = jest.spyOn(paystackPayout, 'initiateTransfer');

      await payouts.processPayout(payout.id);
      expect(await payouts.enqueueDuePayouts()).toBe(0);

      expect(transfer).not.toHaveBeenCalled();
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        'QUEUED',
      );
      expect(await entertainerBalance()).toBe(425000);

      // KYC clears -> the sweep releases the held payout.
      await prisma.entertainer.update({
        where: { id: entertainer.id },
        data: { kycStatus: 'VERIFIED' },
      });
      payoutsQueue.add.mockClear();
      expect(await payouts.enqueueDuePayouts()).toBe(1);
      expect(payoutsQueue.add.mock.calls[0][1]).toEqual({ payoutId: payout.id });
    });

    it('a failed payout keeps the full payable balance, and a retry pays it once', async () => {
      const { payout } = await settledPaymentWithEntertainerPayout();
      const transfer = jest.spyOn(paystackPayout, 'initiateTransfer').mockResolvedValue({
        reference: 'x',
        status: 'pending',
        amountKobo: 425000,
        createdAt: new Date(),
      });

      await payouts.processPayout(payout.id);
      const firstRef = (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }))
        .transferReference!;

      // Bank bounces it.
      await sendWebhook({
        event: 'transfer.failed',
        data: { id: 9001, reference: firstRef, status: 'failed' },
      }).expect(200);
      await drainWebhookJobs();

      expect(await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
        status: 'RETRYING',
      });
      expect(await entertainerBalance()).toBe(425000); // liability intact
      expect(payoutsQueue.add).toHaveBeenLastCalledWith(
        'process-payout',
        { payoutId: payout.id },
        expect.objectContaining({ delay: 60000 }),
      );

      // Retry: old reference verified as failed, new reference used, success.
      jest.spyOn(paystackPayout, 'verifyTransfer').mockResolvedValue({
        reference: firstRef,
        status: 'failed',
        amountKobo: 425000,
      });
      transfer.mockResolvedValue({
        reference: 'y',
        status: 'success',
        amountKobo: 425000,
        createdAt: new Date(),
      });
      await payouts.processPayout(payout.id);

      const done = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(done).toMatchObject({ status: 'SUCCESS', attempts: 2 });
      expect(done.transferReference).not.toBe(firstRef);
      expect(await entertainerBalance()).toBe(0);
    });

    it('never re-sends a transfer whose first attempt had an ambiguous outcome', async () => {
      const { payout } = await settledPaymentWithEntertainerPayout();
      const transfer = jest
        .spyOn(paystackPayout, 'initiateTransfer')
        .mockRejectedValue(new Error('socket hang up'));

      await expect(payouts.processPayout(payout.id)).rejects.toThrow('socket hang up');
      const inFlight = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(inFlight).toMatchObject({ status: 'PROCESSING', attempts: 1 });
      expect(await entertainerBalance()).toBe(425000);

      // It actually went through at the provider.
      jest.spyOn(paystackPayout, 'verifyTransfer').mockResolvedValue({
        reference: inFlight.transferReference!,
        status: 'success',
        amountKobo: 425000,
      });
      await payouts.processPayout(payout.id); // BullMQ retry
      await payouts.processPayout(payout.id); // and another, for good measure

      expect(transfer).toHaveBeenCalledTimes(1);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        'SUCCESS',
      );
      expect(await entertainerBalance()).toBe(0);
    });

    it('a reversal after success restores the balance with compensating entries', async () => {
      const { payout, payment } = await settledPaymentWithEntertainerPayout();
      jest.spyOn(paystackPayout, 'initiateTransfer').mockResolvedValue({
        reference: 'x',
        status: 'success',
        amountKobo: 425000,
        createdAt: new Date(),
      });
      await payouts.processPayout(payout.id);
      expect(await entertainerBalance()).toBe(0);
      const ref = (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }))
        .transferReference!;

      await payouts.handleTransferEvent(ref, 'reversed');
      await payouts.handleTransferEvent(ref, 'reversed'); // duplicate is a no-op

      expect(await entertainerBalance()).toBe(425000);
      // 4 settlement + 2 payout + 2 reversal; nothing updated or deleted
      expect(await ledgerFor(payment.id)).toHaveLength(8);
    });

    it('sends a payout with bad bank details to manual review without touching the balance', async () => {
      await prisma.entertainer.update({
        where: { id: entertainer.id },
        data: { bankName: 'Bank of Nowhere' },
      });
      const { payout } = await settledPaymentWithEntertainerPayout();

      await payouts.processPayout(payout.id);

      const reviewed = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(reviewed.status).toBe('FAILED');
      expect(reviewed.failureReason).toMatch(/^MANUAL_REVIEW/);
      expect(await entertainerBalance()).toBe(425000);

      await payouts.retryPayout(payout.id);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        'RETRYING',
      );
    });
  });

  // -------------------------------------------------- database-level guarantees

  describe('ledger integrity enforced by the database', () => {
    it('refuses to update or delete a ledger entry', async () => {
      const { payment } = await settledPaymentWithEntertainerPayout();
      const [entry] = await ledgerFor(payment.id);

      await expect(
        prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amountKobo: 1 } }),
      ).rejects.toThrow(/immutable/);
      await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
        /immutable/,
      );
    });

    it('refuses to commit an unbalanced posting, even if application code tried', async () => {
      const { payment } = await settledPaymentWithEntertainerPayout();
      const account = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PLATFORM_REVENUE' },
      });

      await expect(
        prisma.ledgerEntry.create({
          data: {
            transactionId: payment.id,
            accountId: account.id,
            direction: 'CREDIT',
            amountKobo: 1,
          },
        }),
      ).rejects.toThrow(/unbalanced ledger/);

      expect(await ledgerFor(payment.id)).toHaveLength(4);
    });
  });

  // ------------------------------------------------------------ reconciliation

  describe('reconciliation', () => {
    it('reports zero drift when the provider balance matches the ledger', async () => {
      const { payout } = await settledPaymentWithEntertainerPayout();
      jest.spyOn(paystackPayout, 'createRecipient').mockResolvedValue({
        recipientCode: 'RCP_test',
        active: true,
      });
      jest.spyOn(paystackPayout, 'initiateTransfer').mockResolvedValue({
        reference: 'x',
        status: 'success',
        amountKobo: 425000,
        createdAt: new Date(),
      });
      await payouts.processPayout(payout.id);

      // ₦5,000 in, ₦4,250 out -> ₦750 should remain at the provider.
      jest.spyOn(paystackPayout, 'getBalance').mockResolvedValue(75000);
      const report = await reconciliation.run();

      expect(report).toMatchObject({
        trialBalanced: true,
        ledgerClearingKobo: 75000,
        providerBalanceKobo: 75000,
        driftKobo: 0,
        entertainerPayableKobo: 0,
        venuePayableKobo: 50000,
        platformRevenueKobo: 25000,
      });
    });

    it('reports drift when they differ', async () => {
      await settledPaymentWithEntertainerPayout();
      jest.spyOn(paystackPayout, 'getBalance').mockResolvedValue(490000);

      const report = await reconciliation.run();

      expect(report.driftKobo).toBe(-10000);
    });
  });
});
