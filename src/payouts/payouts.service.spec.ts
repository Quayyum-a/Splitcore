/**
 * Unit tests for PayoutsService — moving what the ledger says is owed out to
 * a bank account.
 *
 * The rules being pinned are the ones that decide whether money can be lost
 * or sent twice: a transfer reference is persisted before the provider is
 * called, an existing attempt is re-verified before a new one starts, the
 * ledger is debited only on confirmed delivery, and a failed transfer leaves
 * the payable balance exactly where it was.
 */

import { Payout, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PayoutProvider } from '../payments/interfaces';
import { MAX_AUTOMATIC_TRANSFER_ATTEMPTS, PayoutsService } from './payouts.service';
import { resolveBankCode } from './bank-codes';

type PayoutRow = Payout & { ledgerAccount: { type: string; ownerId: string | null } };

function makePayout(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: 'payout-1',
    ledgerAccountId: 'acct-1',
    transactionId: 'txn-1',
    transferReference: null,
    recipientCode: null,
    amountKobo: 425000,
    status: 'QUEUED' as PayoutStatus,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ledgerAccount: { type: 'ENTERTAINER_PAYABLE', ownerId: 'ent-1' },
    ...overrides,
  } as PayoutRow;
}

function makeEntertainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ent-1',
    stageName: 'DJ Mike',
    legalName: 'Michael Okafor',
    bankName: 'GTBank',
    accountNumber: '0123456789',
    kycStatus: 'VERIFIED',
    ...overrides,
  };
}

function buildHarness() {
  const tx = {
    payout: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma = {
    payout: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    entertainer: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };

  const provider = {
    name: 'paystack',
    getBalance: jest.fn(),
    createRecipient: jest.fn().mockResolvedValue({ recipientCode: 'RCP_1', active: true }),
    initiateTransfer: jest.fn().mockResolvedValue({ status: 'pending' }),
    verifyTransfer: jest.fn(),
  };

  const ledgerRepository = { post: jest.fn().mockResolvedValue(undefined) };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

  const service = new PayoutsService(
    prisma as unknown as PrismaService,
    new LedgerService(),
    ledgerRepository as unknown as LedgerRepository,
    provider as unknown as PayoutProvider,
    queue as never,
  );

  return { service, prisma, provider, ledgerRepository, queue, tx };
}

describe('resolveBankCode', () => {
  it('maps a known bank name to its provider code', () => {
    expect(resolveBankCode('GTBank')).toBe('058');
  });

  it('returns undefined for an unknown name rather than guessing', () => {
    expect(resolveBankCode('Bank of Nowhere')).toBeUndefined();
  });
});

describe('PayoutsService.processPayout', () => {
  it('does nothing for an unknown payout id', async () => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(null);

    await h.service.processPayout('missing');

    expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
  });

  it.each(['SUCCESS', 'CANCELLED', 'FAILED'])('leaves a %s payout alone', async (status) => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(makePayout({ status: status as PayoutStatus }));

    await h.service.processPayout('payout-1');

    expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
  });

  describe('when an earlier attempt already reached the provider', () => {
    it('records success and debits the ledger instead of transferring again', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(
        makePayout({ status: 'PROCESSING', transferReference: 'po_x_1', attempts: 1 }),
      );
      h.prisma.payout.findUniqueOrThrow.mockResolvedValue(
        makePayout({ status: 'PROCESSING', transferReference: 'po_x_1', attempts: 1 }),
      );
      h.provider.verifyTransfer.mockResolvedValue({ status: 'success' });

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.ledgerRepository.post).toHaveBeenCalledTimes(1);
    });

    it('waits rather than double-sending while the transfer is still pending', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(
        makePayout({ status: 'PROCESSING', transferReference: 'po_x_1', attempts: 1 }),
      );
      h.provider.verifyTransfer.mockResolvedValue({ status: 'pending' });

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    // The previous attempt is parked at the provider awaiting a one-time code.
    // It is NOT "moved no money" - it may still pay out. Starting another
    // transfer here would settle the same obligation twice.
    it('never starts a second transfer while the previous one awaits human action', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(
        makePayout({ status: 'PROCESSING', attempts: 1, transferReference: 'po_x_1' }),
      );
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.provider.verifyTransfer.mockResolvedValue({ status: 'requires_action' });

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    it('starts a fresh attempt once the previous one is known to have failed', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(
        makePayout({ status: 'RETRYING', transferReference: 'po_x_1', attempts: 1 }),
      );
      h.provider.verifyTransfer.mockResolvedValue({ status: 'failed' });
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).toHaveBeenCalledTimes(1);
      // A new attempt gets its own reference, so it cannot collide with the old one.
      expect(h.provider.initiateTransfer.mock.calls[0][0].reference).toMatch(/_2$/);
    });
  });

  describe('gating', () => {
    it('holds a payout for an entertainer who is not KYC verified', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer({ kycStatus: 'PENDING' }));

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    it('leaves a venue payout queued, since venue destinations are not modelled yet', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(
        makePayout({ ledgerAccount: { type: 'VENUE_PAYABLE', ownerId: 'venue-1' } }),
      );

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.prisma.payout.updateMany).not.toHaveBeenCalled();
    });

    it('sends a payout with missing bank details to manual review', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer({ accountNumber: null }));

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.prisma.payout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: expect.stringContaining('MANUAL_REVIEW'),
          }),
        }),
      );
    });

    it('sends an unrecognised bank to manual review rather than guessing a code', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(
        makeEntertainer({ bankName: 'Bank of Nowhere' }),
      );

      await h.service.processPayout('payout-1');

      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
      expect(h.prisma.payout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failureReason: expect.stringContaining('Unknown bank'),
          }),
        }),
      );
    });
  });

  describe('a fresh transfer', () => {
    it('persists the reference and claims the attempt before calling the provider', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());

      await h.service.processPayout('payout-1');

      const claim = h.prisma.payout.updateMany.mock.calls[0][0];
      expect(claim.data).toMatchObject({ status: 'PROCESSING', attempts: 1 });
      expect(claim.data.transferReference).toMatch(/^po_/);
      // The attempts guard is what makes a concurrent worker lose the race.
      expect(claim.where).toMatchObject({ attempts: 0 });

      const claimOrder = h.prisma.payout.updateMany.mock.invocationCallOrder[0];
      const transferOrder = h.provider.initiateTransfer.mock.invocationCallOrder[0];
      expect(claimOrder).toBeLessThan(transferOrder);
    });

    it('does nothing further when a concurrent worker won the claim', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.prisma.payout.updateMany.mockResolvedValue({ count: 0 });

      await h.service.processPayout('payout-1');

      expect(h.provider.createRecipient).not.toHaveBeenCalled();
      expect(h.provider.initiateTransfer).not.toHaveBeenCalled();
    });

    it('debits the ledger when the provider confirms delivery immediately', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.payout.findUniqueOrThrow.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.provider.initiateTransfer.mockResolvedValue({ status: 'success' });

      await h.service.processPayout('payout-1');

      const [, transactionId, entries] = h.ledgerRepository.post.mock.calls[0];
      expect(transactionId).toBe('txn-1');
      expect(entries).toEqual([
        {
          accountType: 'ENTERTAINER_PAYABLE',
          ownerId: 'ent-1',
          direction: 'DEBIT',
          amountKobo: 425000,
        },
        {
          accountType: 'PROCESSOR_CLEARING',
          ownerId: null,
          direction: 'CREDIT',
          amountKobo: 425000,
        },
      ]);
    });

    it('posts nothing while the transfer is still pending', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.provider.initiateTransfer.mockResolvedValue({ status: 'pending' });

      await h.service.processPayout('payout-1');

      expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    });

    // Paystack answers `otp` when "Disable OTP for Transfers" is still on for
    // the account. No webhook will ever arrive for it, so treating it as
    // pending parks the payout in PROCESSING indefinitely while the system
    // reports nothing wrong. It must stay PROCESSING (re-sending risks paying
    // twice, because the transfer really is live at the provider) but say
    // loudly that a person has to act.
    it('flags a transfer that needs human action instead of silently waiting', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.provider.initiateTransfer.mockResolvedValue({ status: 'requires_action' });

      await h.service.processPayout('payout-1');

      // liability untouched - the money is still owed
      expect(h.ledgerRepository.post).not.toHaveBeenCalled();

      const flagged = h.prisma.payout.update.mock.calls
        .map((c) => c[0])
        .find((arg) => typeof arg.data?.failureReason === 'string');
      expect(flagged).toBeDefined();
      expect(flagged.data.failureReason).toMatch(/OTP|action required/i);
      // not marked FAILED: the provider-side transfer is still outstanding
      expect(flagged.data.status).toBeUndefined();
    });

    it('does not mark a requires_action payout as succeeded or failed', async () => {
      const h = buildHarness();
      h.prisma.payout.findUnique.mockResolvedValue(makePayout());
      h.prisma.entertainer.findUnique.mockResolvedValue(makeEntertainer());
      h.provider.initiateTransfer.mockResolvedValue({ status: 'requires_action' });

      await h.service.processPayout('payout-1');

      const statuses = [
        ...h.prisma.payout.update.mock.calls,
        ...h.prisma.payout.updateMany.mock.calls,
      ]
        .map((c) => c[0]?.data?.status)
        .filter(Boolean);
      expect(statuses).not.toContain('SUCCESS');
      expect(statuses).not.toContain('FAILED');
    });
  });
});

describe('PayoutsService.handleTransferEvent', () => {
  it('ignores a transfer reference it does not recognise', async () => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(null);

    await h.service.handleTransferEvent('po_unknown_1', 'success');

    expect(h.ledgerRepository.post).not.toHaveBeenCalled();
  });

  it('records a confirmed transfer and debits the payable account', async () => {
    const h = buildHarness();
    const payout = makePayout({ status: 'PROCESSING', transferReference: 'po_x_1', attempts: 1 });
    h.prisma.payout.findUnique.mockResolvedValue(payout);
    h.prisma.payout.findUniqueOrThrow.mockResolvedValue(payout);

    await h.service.handleTransferEvent('po_x_1', 'success');

    expect(h.ledgerRepository.post).toHaveBeenCalledTimes(1);
  });

  it('leaves the payable balance intact when a transfer fails', async () => {
    // Nothing was posted for the attempt, so the liability is already whole;
    // only the payout's own state changes.
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(
      makePayout({ status: 'PROCESSING', transferReference: 'po_x_1', attempts: 1 }),
    );

    await h.service.handleTransferEvent('po_x_1', 'failed', 'Account closed');

    expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    expect(h.prisma.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'RETRYING', failureReason: 'Account closed' },
      }),
    );
    expect(h.queue.add).toHaveBeenCalledTimes(1);
  });

  it('restores the obligation with compensating entries when a paid transfer reverses', async () => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(
      makePayout({ status: 'SUCCESS', transferReference: 'po_x_1', attempts: 1 }),
    );

    await h.service.handleTransferEvent('po_x_1', 'reversed', 'Bank returned funds');

    const entries = h.ledgerRepository.post.mock.calls[0][2];
    expect(entries).toEqual([
      {
        accountType: 'ENTERTAINER_PAYABLE',
        ownerId: 'ent-1',
        direction: 'CREDIT',
        amountKobo: 425000,
      },
      {
        accountType: 'PROCESSOR_CLEARING',
        ownerId: null,
        direction: 'DEBIT',
        amountKobo: 425000,
      },
    ]);
  });

  it('ignores a late failure for an attempt already confirmed successful', async () => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(
      makePayout({ status: 'SUCCESS', transferReference: 'po_x_1', attempts: 1 }),
    );

    await h.service.handleTransferEvent('po_x_1', 'failed');

    expect(h.ledgerRepository.post).not.toHaveBeenCalled();
    expect(h.prisma.payout.updateMany).not.toHaveBeenCalled();
  });

  it('stops retrying and asks for a human after the attempt limit', async () => {
    const h = buildHarness();
    h.prisma.payout.findUnique.mockResolvedValue(
      makePayout({
        status: 'PROCESSING',
        transferReference: 'po_x_3',
        attempts: MAX_AUTOMATIC_TRANSFER_ATTEMPTS,
      }),
    );

    await h.service.handleTransferEvent('po_x_3', 'failed', 'Account closed');

    expect(h.queue.add).not.toHaveBeenCalled();
    expect(h.prisma.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringContaining('MANUAL_REVIEW'),
        }),
      }),
    );
  });
});

describe('PayoutsService.retryPayout', () => {
  it('re-opens a FAILED payout and queues it', async () => {
    const h = buildHarness();
    h.prisma.payout.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.payout.findUniqueOrThrow.mockResolvedValue(makePayout({ status: 'RETRYING' }));

    await h.service.retryPayout('payout-1');

    expect(h.queue.add).toHaveBeenCalledTimes(1);
  });

  it('reports a missing payout as not found', async () => {
    const h = buildHarness();
    h.prisma.payout.updateMany.mockResolvedValue({ count: 0 });
    h.prisma.payout.findUnique.mockResolvedValue(null);

    await expect(h.service.retryPayout('nope')).rejects.toThrow('Payout not found');
  });

  it('refuses to retry a payout that is not FAILED', async () => {
    const h = buildHarness();
    h.prisma.payout.updateMany.mockResolvedValue({ count: 0 });
    h.prisma.payout.findUnique.mockResolvedValue(makePayout({ status: 'SUCCESS' }));

    await expect(h.service.retryPayout('payout-1')).rejects.toThrow(/only FAILED/);
    expect(h.queue.add).not.toHaveBeenCalled();
  });
});

describe('PayoutsService.enqueueDuePayouts', () => {
  it('enqueues only payouts whose entertainer is now KYC verified', async () => {
    const h = buildHarness();
    h.prisma.payout.findMany.mockResolvedValue([
      { id: 'p1', ledgerAccount: { ownerId: 'ent-verified' } },
      { id: 'p2', ledgerAccount: { ownerId: 'ent-pending' } },
    ]);
    h.prisma.entertainer.findMany.mockResolvedValue([{ id: 'ent-verified' }]);

    await expect(h.service.enqueueDuePayouts()).resolves.toBe(1);

    expect(h.queue.add).toHaveBeenCalledTimes(1);
    expect(h.queue.add.mock.calls[0][1]).toEqual({ payoutId: 'p1' });
  });

  it('returns zero when nothing is due', async () => {
    const h = buildHarness();

    await expect(h.service.enqueueDuePayouts()).resolves.toBe(0);
    expect(h.queue.add).not.toHaveBeenCalled();
  });
});
