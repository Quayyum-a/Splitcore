/**
 * Unit tests for PaymentSettlementService — the only code path that moves a
 * payment to SUCCESS and writes its ledger posting.
 *
 * The PRD gives the ledger the highest testing priority, so these pin the
 * money-safety rules directly rather than only through the e2e flow:
 * provider verification is authoritative, settlement is idempotent under
 * concurrency, and a mismatch is parked rather than guessed at.
 */

import { PaymentStatus, PaymentTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PaymentProvider } from './interfaces';
import {
  PaymentSettlementService,
  SettlementIntegrityError,
  payoutJobOptions,
} from './payment-settlement.service';

const SPLIT_RULE = {
  id: 'split-1',
  entertainerBps: 8500,
  venueBps: 1000,
  platformBps: 500,
};

function makePayment(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 'txn-1',
    externalReference: 'pay_ref_1',
    provider: 'paystack',
    venueId: 'venue-1',
    entertainerId: 'ent-1',
    guestSessionId: 'sess-1',
    grossAmountKobo: 500000,
    guestDisplayName: null,
    displayNameEnabled: false,
    splitRuleId: SPLIT_RULE.id,
    status: 'CREATED' as PaymentStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentTransaction;
}

interface Harness {
  service: PaymentSettlementService;
  prisma: {
    paymentTransaction: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
    splitRule: { findUniqueOrThrow: jest.Mock };
    payout: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  provider: { verifyPayment: jest.Mock; name: string };
  ledgerRepository: { post: jest.Mock; resolveAccountId: jest.Mock };
  queue: { add: jest.Mock };
  tx: { paymentTransaction: { updateMany: jest.Mock }; payout: { create: jest.Mock } };
}

function buildHarness(options: { claimed?: boolean } = {}): Harness {
  const claimCount = options.claimed === false ? 0 : 1;

  const tx = {
    paymentTransaction: { updateMany: jest.fn().mockResolvedValue({ count: claimCount }) },
    payout: {
      create: jest
        .fn()
        .mockImplementation(async ({ data }: { data: { ledgerAccountId: string } }) => ({
          id: `payout-${data.ledgerAccountId}`,
        })),
    },
  };

  const prisma = {
    paymentTransaction: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    splitRule: { findUniqueOrThrow: jest.fn().mockResolvedValue(SPLIT_RULE) },
    payout: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };

  const provider = { name: 'paystack', verifyPayment: jest.fn() };
  const ledgerRepository = {
    post: jest.fn().mockResolvedValue(undefined),
    resolveAccountId: jest
      .fn()
      .mockImplementation(
        async (_tx: unknown, type: string, ownerId: string | null) =>
          `acct-${type}-${ownerId ?? 'system'}`,
      ),
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

  const service = new PaymentSettlementService(
    prisma as unknown as PrismaService,
    new LedgerService(),
    ledgerRepository as unknown as LedgerRepository,
    provider as unknown as PaymentProvider,
    queue as never,
  );

  return { service, prisma, provider, ledgerRepository, queue, tx };
}

describe('PaymentSettlementService', () => {
  describe('settle()', () => {
    it('returns null for an unknown reference rather than inventing a payment', async () => {
      const h = buildHarness();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(null);

      await expect(h.service.settle('pay_nope')).resolves.toBeNull();
      expect(h.provider.verifyPayment).not.toHaveBeenCalled();
    });

    it('does not re-verify a payment that is already SUCCESS', async () => {
      const h = buildHarness();
      const settled = makePayment({ status: 'SUCCESS' });
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(settled);

      await expect(h.service.settle(settled.externalReference)).resolves.toBe(settled);
      expect(h.provider.verifyPayment).not.toHaveBeenCalled();
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    it('marks a provider-confirmed failure as FAILED and posts nothing', async () => {
      const h = buildHarness();
      const payment = makePayment();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        status: 'FAILED',
      });
      h.provider.verifyPayment.mockResolvedValue({ status: 'failed', amountKobo: 500000 });

      const result = await h.service.settle(payment.externalReference);

      expect(result?.status).toBe('FAILED');
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    it('holds an unconfirmed payment at PENDING rather than calling it abandoned', async () => {
      // Paystack reports "abandoned" for a checkout page that is merely still
      // open. Treating that as terminal would strand a guest mid-payment.
      const h = buildHarness();
      const payment = makePayment();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        status: 'PENDING',
      });
      h.provider.verifyPayment.mockResolvedValue({ status: 'abandoned', amountKobo: 500000 });

      const result = await h.service.settle(payment.externalReference);

      expect(result?.status).toBe('PENDING');
      expect(h.prisma.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: payment.id, status: { in: ['CREATED'] } },
        data: { status: 'PENDING' },
      });
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    it('settles a confirmed payment: claim, balanced posting, payout obligations', async () => {
      const h = buildHarness();
      const payment = makePayment();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        status: 'SUCCESS',
      });
      h.provider.verifyPayment.mockResolvedValue({
        status: 'success',
        amountKobo: 500000,
        currency: 'NGN',
      });

      const result = await h.service.settle(payment.externalReference);

      expect(result?.status).toBe('SUCCESS');

      const [, transactionId, entries] = h.ledgerRepository.post.mock.calls[0];
      expect(transactionId).toBe(payment.id);
      // 85/10/5 of ₦5,000, balanced against the clearing debit.
      expect(entries).toEqual([
        {
          accountType: 'PROCESSOR_CLEARING',
          ownerId: null,
          direction: 'DEBIT',
          amountKobo: 500000,
        },
        {
          accountType: 'ENTERTAINER_PAYABLE',
          ownerId: 'ent-1',
          direction: 'CREDIT',
          amountKobo: 425000,
        },
        {
          accountType: 'VENUE_PAYABLE',
          ownerId: 'venue-1',
          direction: 'CREDIT',
          amountKobo: 50000,
        },
        { accountType: 'PLATFORM_REVENUE', ownerId: null, direction: 'CREDIT', amountKobo: 25000 },
      ]);

      // One payout obligation per payable credit; revenue and clearing get none.
      expect(h.tx.payout.create).toHaveBeenCalledTimes(2);
      expect(h.queue.add).toHaveBeenCalledTimes(2);
    });

    it('divides by the split rule snapshotted at initialization', async () => {
      // A venue editing its split mid-payment must not change how an
      // already-accepted payment is divided.
      const h = buildHarness();
      const payment = makePayment({ splitRuleId: 'split-quoted' });
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue(payment);
      h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });

      await h.service.settle(payment.externalReference);

      expect(h.prisma.splitRule.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'split-quoted' },
      });
    });

    it('writes nothing when a concurrent caller wins the claim', async () => {
      const h = buildHarness({ claimed: false });
      const payment = makePayment();
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        status: 'SUCCESS',
      });
      h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });

      const result = await h.service.settle(payment.externalReference);

      expect(result?.status).toBe('SUCCESS');
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
      expect(h.tx.payout.create).not.toHaveBeenCalled();
      expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('gives the entertainer share to the venue when the QR has no entertainer', async () => {
      const h = buildHarness();
      const payment = makePayment({ entertainerId: null });
      h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
      h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue(payment);
      h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });

      await h.service.settle(payment.externalReference);

      const entries = h.ledgerRepository.post.mock.calls[0][2];
      expect(entries).toContainEqual({
        accountType: 'VENUE_PAYABLE',
        ownerId: 'venue-1',
        direction: 'CREDIT',
        amountKobo: 475000,
      });
      expect(
        entries.some((e: { accountType: string }) => e.accountType === 'ENTERTAINER_PAYABLE'),
      ).toBe(false);
      expect(h.tx.payout.create).toHaveBeenCalledTimes(1);
    });

    describe('integrity guards', () => {
      it('refuses to settle when the provider reports a different amount', async () => {
        const h = buildHarness();
        const payment = makePayment();
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 100 });

        await expect(h.service.settle(payment.externalReference)).rejects.toThrow(
          SettlementIntegrityError,
        );
        expect(h.ledgerRepository.post).not.toHaveBeenCalled();
      });

      it('refuses to settle a charge in an unexpected currency', async () => {
        const h = buildHarness();
        const payment = makePayment();
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.provider.verifyPayment.mockResolvedValue({
          status: 'success',
          amountKobo: 500000,
          currency: 'USD',
        });

        await expect(h.service.settle(payment.externalReference)).rejects.toThrow(/Currency/);
        expect(h.ledgerRepository.post).not.toHaveBeenCalled();
      });

      it('refuses to invent a split when the snapshot is missing', async () => {
        const h = buildHarness();
        const payment = makePayment({ splitRuleId: null });
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });

        await expect(h.service.settle(payment.externalReference)).rejects.toThrow(
          /no split rule snapshot/,
        );
        expect(h.ledgerRepository.post).not.toHaveBeenCalled();
      });

      it('leaves the payment status untouched when integrity fails', async () => {
        // Money may have moved, so the payment must not be silently FAILED.
        const h = buildHarness();
        const payment = makePayment();
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 999 });

        await expect(h.service.settle(payment.externalReference)).rejects.toThrow(
          SettlementIntegrityError,
        );
        expect(h.prisma.paymentTransaction.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('payout enqueueing', () => {
      it('still settles when the queue is unavailable', async () => {
        // The payout rows are committed as QUEUED; the sweep picks them up.
        const h = buildHarness();
        const payment = makePayment();
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
          ...payment,
          status: 'SUCCESS',
        });
        h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });
        h.queue.add.mockRejectedValue(new Error('Connection is closed.'));

        const result = await h.service.settle(payment.externalReference);

        expect(result?.status).toBe('SUCCESS');
        expect(h.ledgerRepository.post).toHaveBeenCalledTimes(1);
      });

      it('does not hang settlement when the queue never responds', async () => {
        const h = buildHarness();
        const payment = makePayment();
        h.prisma.paymentTransaction.findUnique.mockResolvedValue(payment);
        h.prisma.paymentTransaction.findUniqueOrThrow.mockResolvedValue({
          ...payment,
          status: 'SUCCESS',
        });
        h.provider.verifyPayment.mockResolvedValue({ status: 'success', amountKobo: 500000 });
        h.queue.add.mockImplementation(() => new Promise(() => {}));

        const started = Date.now();
        await h.service.settle(payment.externalReference);

        expect(Date.now() - started).toBeLessThan(10000);
      }, 15000);
    });
  });

  describe('payoutJobOptions()', () => {
    it('dedupes by payout id so a re-enqueue is a no-op', () => {
      expect(payoutJobOptions('p1').jobId).toBe('payout:p1');
    });

    it('removes finished jobs so the same payout can be retried later', () => {
      const opts = payoutJobOptions('p1');
      expect(opts.removeOnComplete).toBe(true);
      expect(opts.removeOnFail).toBe(true);
      expect(opts.attempts).toBeGreaterThan(1);
    });
  });
});
