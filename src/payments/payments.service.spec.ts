/**
 * Unit tests for PaymentsService — guest checkout initialization and the
 * status poll the frontend uses while waiting for the webhook.
 *
 * Phase 3's two load-bearing rules are pinned here: no payment is accepted
 * that we do not already know how to divide, and SUCCESS is never set from
 * anything the client tells us.
 */

import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SplitRulesService } from '../split-rules/split-rules.service';
import { PaymentProvider } from './interfaces';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto';

const NOW = new Date('2026-09-25T20:00:00.000Z');

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    qrCode: {
      publicToken: 'tok-quilox-vip-1',
      venueId: 'venue-1',
      entertainerId: 'ent-1',
      isActive: true,
      deactivatedAt: null,
      venue: { id: 'venue-1', name: 'Quilox', isActive: true },
      entertainer: { id: 'ent-1', stageName: 'DJ Mike', isActive: true },
    },
    ...overrides,
  };
}

const DTO: InitializePaymentDto = {
  sessionId: 'sess-1',
  amountKobo: 500000,
  email: 'guest@example.com',
} as InitializePaymentDto;

function buildHarness(config: Record<string, string | undefined> = {}) {
  const prisma = {
    guestSession: { findUnique: jest.fn().mockResolvedValue(makeSession()) },
    paymentTransaction: {
      create: jest.fn().mockResolvedValue({ id: 'txn-1', status: 'CREATED' }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  const splitRules = { findActiveByVenue: jest.fn().mockResolvedValue({ id: 'split-1' }) };
  const settlement = { settle: jest.fn().mockResolvedValue(null) };
  const provider = {
    name: 'paystack',
    initializePayment: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'acc_1',
      reference: 'echoed',
    }),
    verifyPayment: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    splitRules as unknown as SplitRulesService,
    settlement as unknown as PaymentSettlementService,
    provider as unknown as PaymentProvider,
    configService,
  );

  return { service, prisma, splitRules, settlement, provider };
}

describe('PaymentsService.initializePayment', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('session and entity validity', () => {
    it('rejects an unknown session', async () => {
      const h = buildHarness();
      h.prisma.guestSession.findUnique.mockResolvedValue(null);

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(NotFoundException);
      expect(h.prisma.paymentTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects an expired session', async () => {
      const h = buildHarness();
      h.prisma.guestSession.findUnique.mockResolvedValue(
        makeSession({ expiresAt: new Date(NOW.getTime() - 1000) }),
      );

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(GoneException);
    });

    it.each([
      ['a deactivated QR code', { isActive: false, deactivatedAt: new Date() }],
      ['a QR code flagged inactive', { isActive: false, deactivatedAt: null }],
    ])('rejects %s', async (_label, qrOverrides) => {
      const h = buildHarness();
      const session = makeSession();
      Object.assign(session.qrCode, qrOverrides);
      h.prisma.guestSession.findUnique.mockResolvedValue(session);

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(GoneException);
    });

    it('rejects a deactivated venue', async () => {
      const h = buildHarness();
      const session = makeSession();
      session.qrCode.venue.isActive = false;
      h.prisma.guestSession.findUnique.mockResolvedValue(session);

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(/Venue is no longer active/);
    });

    it('rejects a deactivated entertainer', async () => {
      const h = buildHarness();
      const session = makeSession();
      session.qrCode.entertainer.isActive = false;
      h.prisma.guestSession.findUnique.mockResolvedValue(session);

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(
        /Entertainer is no longer active/,
      );
    });

    it('accepts a venue-only QR code with no entertainer attached', async () => {
      const h = buildHarness();
      const session = makeSession();
      session.qrCode.entertainer = null as never;
      session.qrCode.entertainerId = null as never;
      h.prisma.guestSession.findUnique.mockResolvedValue(session);

      await expect(h.service.initializePayment(DTO)).resolves.toMatchObject({
        transactionId: 'txn-1',
      });
    });
  });

  describe('split rule requirement', () => {
    it('refuses the payment when the venue has no active split rule', async () => {
      // Never accept money we do not yet know how to divide.
      const h = buildHarness();
      h.splitRules.findActiveByVenue.mockRejectedValue(new NotFoundException('none'));

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(BadRequestException);
      expect(h.prisma.paymentTransaction.create).not.toHaveBeenCalled();
      expect(h.provider.initializePayment).not.toHaveBeenCalled();
    });

    it('propagates an unexpected split-rule lookup failure unchanged', async () => {
      const h = buildHarness();
      h.splitRules.findActiveByVenue.mockRejectedValue(new Error('database down'));

      await expect(h.service.initializePayment(DTO)).rejects.toThrow('database down');
    });

    it('snapshots the split rule onto the payment', async () => {
      const h = buildHarness();

      await h.service.initializePayment(DTO);

      expect(h.prisma.paymentTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ splitRuleId: 'split-1', status: 'CREATED' }),
      });
    });
  });

  describe('checkout creation', () => {
    it('generates its own unique reference rather than reusing the provider’s', async () => {
      const h = buildHarness();

      const result = await h.service.initializePayment(DTO);

      expect(result.reference).toMatch(/^pay_/);
      expect(h.provider.initializePayment).toHaveBeenCalledWith(
        expect.objectContaining({ reference: result.reference }),
      );
      // The provider echoing a different reference must not change ours.
      expect(result.reference).not.toBe('echoed');
    });

    it('returns the hosted checkout URL to the guest', async () => {
      const h = buildHarness();

      await expect(h.service.initializePayment(DTO)).resolves.toMatchObject({
        authorizationUrl: 'https://checkout.paystack.com/abc',
        accessCode: 'acc_1',
        amountKobo: 500000,
        status: 'CREATED',
      });
    });

    it('appends the reference to the configured callback URL', async () => {
      const h = buildHarness({ PAYMENT_CALLBACK_URL: 'https://app.example.com/confirming' });

      const result = await h.service.initializePayment(DTO);

      expect(h.provider.initializePayment.mock.calls[0][0].callbackUrl).toBe(
        `https://app.example.com/confirming?reference=${result.reference}`,
      );
    });

    it('preserves a query string the callback URL already carries', async () => {
      const h = buildHarness({
        PAYMENT_CALLBACK_URL: 'https://app.example.com/confirming?venue=quilox',
      });

      const result = await h.service.initializePayment(DTO);

      const callbackUrl = new URL(h.provider.initializePayment.mock.calls[0][0].callbackUrl);
      expect(callbackUrl.searchParams.get('venue')).toBe('quilox');
      expect(callbackUrl.searchParams.get('reference')).toBe(result.reference);
    });

    it('ignores a malformed callback URL rather than sending a broken one', async () => {
      const h = buildHarness({ PAYMENT_CALLBACK_URL: 'not a url' });

      await h.service.initializePayment(DTO);

      expect(h.provider.initializePayment.mock.calls[0][0].callbackUrl).toBeUndefined();
    });

    it('defers to the provider dashboard callback when none is configured', async () => {
      const h = buildHarness();

      await h.service.initializePayment(DTO);

      expect(h.provider.initializePayment.mock.calls[0][0].callbackUrl).toBeUndefined();
    });

    // The guest must come back to the same page the QR sent them to, carrying
    // the reference, so the frontend can poll GET /payments/:reference/status.
    // Sending them to the bare API instead is what makes a working payment look
    // like a broken flow.
    it('sends the guest back to the frontend tipping page for this QR token', async () => {
      const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app' });

      const result = await h.service.initializePayment(DTO);

      const url = new URL(h.provider.initializePayment.mock.calls[0][0].callbackUrl);
      expect(url.origin).toBe('https://splitcore-app.netlify.app');
      expect(url.pathname).toBe('/t/tok-quilox-vip-1');
      expect(url.searchParams.get('reference')).toBe(result.reference);
    });

    it('tolerates a trailing slash on FRONTEND_URL', async () => {
      const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app/' });

      await h.service.initializePayment(DTO);

      const url = new URL(h.provider.initializePayment.mock.calls[0][0].callbackUrl);
      expect(url.pathname).toBe('/t/tok-quilox-vip-1');
    });

    it('percent-encodes a public token so it cannot escape the path', async () => {
      const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app' });
      h.prisma.guestSession.findUnique.mockResolvedValue(
        makeSession({
          qrCode: { ...makeSession().qrCode, publicToken: 'a/../../evil?x=1' },
        }),
      );

      await h.service.initializePayment(DTO);

      const url = new URL(h.provider.initializePayment.mock.calls[0][0].callbackUrl);
      expect(url.pathname).toBe('/t/a%2F..%2F..%2Fevil%3Fx%3D1');
    });

    // FRONTEND_URL produces the correct per-token deep link, so it wins over
    // the older single-URL setting rather than the other way round: a stale
    // PAYMENT_CALLBACK_URL left pointing at the API must not defeat the fix.
    it('prefers FRONTEND_URL over a legacy PAYMENT_CALLBACK_URL', async () => {
      const h = buildHarness({
        FRONTEND_URL: 'https://splitcore-app.netlify.app',
        PAYMENT_CALLBACK_URL: 'https://splitcore-api.onrender.com/payments/callback',
      });

      await h.service.initializePayment(DTO);

      const url = new URL(h.provider.initializePayment.mock.calls[0][0].callbackUrl);
      expect(url.host).toBe('splitcore-app.netlify.app');
    });

    it('falls back to PAYMENT_CALLBACK_URL when FRONTEND_URL is unset', async () => {
      const h = buildHarness({ PAYMENT_CALLBACK_URL: 'https://app.example.com/confirming' });

      const result = await h.service.initializePayment(DTO);

      expect(h.provider.initializePayment.mock.calls[0][0].callbackUrl).toBe(
        `https://app.example.com/confirming?reference=${result.reference}`,
      );
    });

    it('ignores a malformed FRONTEND_URL rather than sending a broken one', async () => {
      const h = buildHarness({ FRONTEND_URL: 'not a url' });

      await h.service.initializePayment(DTO);

      expect(h.provider.initializePayment.mock.calls[0][0].callbackUrl).toBeUndefined();
    });

    it('marks the payment FAILED when checkout could not be created', async () => {
      // The guest never received a URL, so no money can have moved.
      const h = buildHarness();
      h.provider.initializePayment.mockRejectedValue(new Error('paystack 503'));

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(BadRequestException);
      expect(h.prisma.paymentTransaction.update).toHaveBeenCalledWith({
        where: { id: 'txn-1' },
        data: { status: 'FAILED' },
      });
    });

    it('does not leak the provider error message to the guest', async () => {
      const h = buildHarness();
      h.provider.initializePayment.mockRejectedValue(new Error('Invalid API key sk_live_abc'));

      await expect(h.service.initializePayment(DTO)).rejects.toThrow(
        /Failed to initialize payment/,
      );
    });
  });
});

describe('PaymentsService.getPaymentStatus', () => {
  const stored = {
    id: 'txn-1',
    externalReference: 'pay_ref_1',
    status: 'SUCCESS',
    grossAmountKobo: 500000,
    createdAt: NOW,
    updatedAt: NOW,
    venue: { name: 'Quilox' },
    entertainer: { stageName: 'DJ Mike' },
  };

  it('rejects an unknown reference', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findUnique.mockResolvedValue(null);

    await expect(h.service.getPaymentStatus('pay_nope')).rejects.toThrow(NotFoundException);
  });

  it('does not re-verify a payment that is already settled', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findUnique.mockResolvedValue({ status: 'SUCCESS' });
    h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue(stored);

    await h.service.getPaymentStatus('pay_ref_1');

    expect(h.settlement.settle).not.toHaveBeenCalled();
  });

  it.each(['CREATED', 'PENDING'])(
    'runs settlement for an unconfirmed %s payment, so a slow webhook is not the only path',
    async (status) => {
      const h = buildHarness();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue({ status });
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue(stored);

      await h.service.getPaymentStatus('pay_ref_1');

      expect(h.settlement.settle).toHaveBeenCalledWith('pay_ref_1');
    },
  );

  it('reports the stored status when settlement fails, never a false success', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findUnique.mockResolvedValue({ status: 'PENDING' });
    h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
      ...stored,
      status: 'PENDING',
    });
    h.settlement.settle.mockRejectedValue(new Error('paystack unreachable'));

    const result = await h.service.getPaymentStatus('pay_ref_1');

    expect(result.status).toBe('PENDING');
  });

  it('returns the venue and entertainer names for the confirmation screen', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findUnique.mockResolvedValue({ status: 'SUCCESS' });
    h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue(stored);

    await expect(h.service.getPaymentStatus('pay_ref_1')).resolves.toMatchObject({
      transactionId: 'txn-1',
      reference: 'pay_ref_1',
      status: 'SUCCESS',
      amountKobo: 500000,
      venueName: 'Quilox',
      entertainerName: 'DJ Mike',
    });
  });

  it('reports a null entertainer name for a venue-only payment', async () => {
    const h = buildHarness();
    h.prisma.paymentTransaction.findUnique.mockResolvedValue({ status: 'SUCCESS' });
    h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
      ...stored,
      entertainer: null,
    });

    await expect(h.service.getPaymentStatus('pay_ref_1')).resolves.toMatchObject({
      entertainerName: null,
    });
  });
});
