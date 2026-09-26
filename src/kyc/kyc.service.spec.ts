import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  KycService,
  maskAccountNumber,
  nextStepFor,
  splitLegalName,
  normalizeName,
} from './kyc.service';
import { KycProvider } from './interfaces/kyc-provider.interface';
import { AccountResolutionError } from './providers/paystack-kyc.provider';

function makeEntertainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ent-1',
    stageName: 'DJ Neptune',
    legalName: 'Patrick Imohiosen',
    phone: '+2348012345001',
    bankName: null,
    bankCode: null,
    accountNumber: null,
    resolvedAccountName: null,
    accountResolvedAt: null,
    accountConfirmedAt: null,
    kycStatus: KycStatus.NOT_STARTED,
    kycSubmittedAt: null,
    kycVerifiedAt: null,
    kycFailureReason: null,
    identityCheckType: null,
    identityCheckedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildHarness(entertainer = makeEntertainer()) {
  const prisma = {
    entertainer: {
      findUnique: jest.fn().mockResolvedValue(entertainer),
      update: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ ...entertainer, ...data })),
    },
  };
  const provider = {
    name: 'paystack',
    resolveAccount: jest.fn().mockResolvedValue({
      accountNumber: '0123456789',
      bankCode: '058',
      accountName: 'PATRICK IMOHIOSEN',
    }),
    verifyIdentity: jest.fn().mockResolvedValue({ outcome: 'verified' }),
  } as unknown as KycProvider;

  const service = new KycService(prisma as unknown as PrismaService, provider);
  return { service, prisma, provider: provider as unknown as jest.Mocked<KycProvider> };
}

const BANK = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };

describe('KycService.submitBankDetails', () => {
  it('moves the entertainer to PENDING', async () => {
    const h = buildHarness();

    const view = await h.service.submitBankDetails('ent-1', BANK);

    expect(view.status).toBe(KycStatus.PENDING);
    expect(view.nextStep).toBe('RESOLVE_ACCOUNT');
  });

  // The important one: passing the name check on one account and then swapping
  // the number underneath it must not be possible.
  it('clears a prior resolution and confirmation when the account number changes', async () => {
    const h = buildHarness(
      makeEntertainer({
        accountNumber: '9999999999',
        bankCode: '058',
        resolvedAccountName: 'SOMEONE ELSE',
        accountConfirmedAt: new Date(),
        kycStatus: KycStatus.VERIFIED,
      }),
    );

    await h.service.submitBankDetails('ent-1', BANK);

    const data = h.prisma.entertainer.update.mock.calls[0][0].data;
    expect(data.resolvedAccountName).toBeNull();
    expect(data.accountConfirmedAt).toBeNull();
    expect(data.kycVerifiedAt).toBeNull();
    expect(data.identityCheckType).toBeNull();
  });

  it('keeps an existing confirmation when the details are unchanged', async () => {
    const confirmed = new Date('2026-09-01T00:00:00Z');
    const h = buildHarness(
      makeEntertainer({
        ...BANK,
        resolvedAccountName: 'PATRICK IMOHIOSEN',
        accountConfirmedAt: confirmed,
      }),
    );

    await h.service.submitBankDetails('ent-1', BANK);

    const data = h.prisma.entertainer.update.mock.calls[0][0].data;
    expect(data.accountConfirmedAt).toBeUndefined();
  });

  it('refuses while suspended', async () => {
    const h = buildHarness(makeEntertainer({ kycStatus: KycStatus.SUSPENDED }));

    await expect(h.service.submitBankDetails('ent-1', BANK)).rejects.toThrow(ConflictException);
  });

  it('404s for an unknown entertainer', async () => {
    const h = buildHarness();
    h.prisma.entertainer.findUnique.mockResolvedValue(null);

    await expect(h.service.submitBankDetails('nope', BANK)).rejects.toThrow(NotFoundException);
  });
});

describe('KycService.resolveAccount', () => {
  it("stores the bank's name, not anything the caller typed", async () => {
    const h = buildHarness(makeEntertainer(BANK));

    const view = await h.service.resolveAccount('ent-1');

    expect(view.resolvedAccountName).toBe('PATRICK IMOHIOSEN');
    expect(view.nextStep).toBe('CONFIRM_ACCOUNT');
  });

  it('invalidates a previous confirmation, so the confirmed name is always the latest', async () => {
    const h = buildHarness(makeEntertainer({ ...BANK, accountConfirmedAt: new Date() }));

    await h.service.resolveAccount('ent-1');

    expect(h.prisma.entertainer.update.mock.calls[0][0].data.accountConfirmedAt).toBeNull();
  });

  it('requires bank details first', async () => {
    const h = buildHarness();

    await expect(h.service.resolveAccount('ent-1')).rejects.toThrow(BadRequestException);
  });

  it('marks KYC FAILED and answers 400 when the bank rejects the details', async () => {
    const h = buildHarness(makeEntertainer(BANK));
    (h.provider.resolveAccount as jest.Mock).mockRejectedValue(
      new AccountResolutionError('Cannot resolve account'),
    );

    await expect(h.service.resolveAccount('ent-1')).rejects.toThrow(BadRequestException);
    expect(h.prisma.entertainer.update.mock.calls[0][0].data.kycStatus).toBe(KycStatus.FAILED);
  });

  it('lets an unexpected provider error surface rather than calling it a failed check', async () => {
    const h = buildHarness(makeEntertainer(BANK));
    (h.provider.resolveAccount as jest.Mock).mockRejectedValue(new Error('socket hang up'));

    await expect(h.service.resolveAccount('ent-1')).rejects.toThrow('socket hang up');
    expect(h.prisma.entertainer.update).not.toHaveBeenCalled();
  });
});

describe('KycService.confirmAccount', () => {
  const resolved = makeEntertainer({ ...BANK, resolvedAccountName: 'PATRICK IMOHIOSEN' });

  it('accepts the name the bank returned', async () => {
    const h = buildHarness(resolved);

    const view = await h.service.confirmAccount('ent-1', 'PATRICK IMOHIOSEN');

    expect(view.accountConfirmedAt).not.toBeNull();
    expect(view.nextStep).toBe('VERIFY_IDENTITY');
  });

  it('ignores case and spacing, which banks are inconsistent about', async () => {
    const h = buildHarness(resolved);

    await expect(
      h.service.confirmAccount('ent-1', '  patrick   imohiosen '),
    ).resolves.toBeDefined();
  });

  it('rejects a name the bank never returned', async () => {
    const h = buildHarness(resolved);

    await expect(h.service.confirmAccount('ent-1', 'Someone Else')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires the account to have been resolved first', async () => {
    const h = buildHarness(makeEntertainer(BANK));

    await expect(h.service.confirmAccount('ent-1', 'Anything')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('KycService.verifyIdentity', () => {
  const confirmed = makeEntertainer({
    ...BANK,
    resolvedAccountName: 'PATRICK IMOHIOSEN',
    accountConfirmedAt: new Date(),
    kycStatus: KycStatus.PENDING,
  });

  it('marks VERIFIED and records the document TYPE only', async () => {
    const h = buildHarness(confirmed);

    const view = await h.service.verifyIdentity('ent-1', {
      documentType: 'BVN',
      documentNumber: '22222222222',
    });

    expect(view.status).toBe(KycStatus.VERIFIED);
    expect(view.payoutsEnabled).toBe(true);
    const data = h.prisma.entertainer.update.mock.calls[0][0].data;
    expect(data.identityCheckType).toBe('BVN');
    // The number is nowhere in what gets persisted.
    expect(JSON.stringify(data)).not.toContain('22222222222');
  });

  // The whole reason 'unavailable' exists as an outcome: the check never ran, so
  // neither VERIFIED nor FAILED would be true.
  it('sends the entertainer to REVIEW when the provider cannot run the check', async () => {
    const h = buildHarness(confirmed);
    (h.provider.verifyIdentity as jest.Mock).mockResolvedValue({
      outcome: 'unavailable',
      reason: 'Identity verification is not enabled on the connected Paystack account.',
    });

    const view = await h.service.verifyIdentity('ent-1', {
      documentType: 'BVN',
      documentNumber: '22222222222',
    });

    expect(view.status).toBe(KycStatus.REVIEW);
    expect(view.failureReason).toContain('not enabled');
    // Payouts stay gated: the money is accounted for, just not released.
    expect(view.payoutsEnabled).toBe(false);
    expect(h.prisma.entertainer.update.mock.calls[0][0].data.identityCheckedAt).toBeNull();
  });

  it('marks FAILED when the provider says the identity does not match', async () => {
    const h = buildHarness(confirmed);
    (h.provider.verifyIdentity as jest.Mock).mockResolvedValue({
      outcome: 'failed',
      reason: 'Name mismatch',
    });

    const view = await h.service.verifyIdentity('ent-1', {
      documentType: 'NIN',
      documentNumber: '22222222222',
    });

    expect(view.status).toBe(KycStatus.FAILED);
    expect(view.payoutsEnabled).toBe(false);
  });

  it('refuses before the bank account has been confirmed', async () => {
    const h = buildHarness(makeEntertainer({ ...BANK, resolvedAccountName: 'PATRICK IMOHIOSEN' }));

    await expect(
      h.service.verifyIdentity('ent-1', { documentType: 'BVN', documentNumber: '22222222222' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to re-verify someone already verified', async () => {
    const h = buildHarness(makeEntertainer({ ...confirmed, kycStatus: KycStatus.VERIFIED }));

    await expect(
      h.service.verifyIdentity('ent-1', { documentType: 'BVN', documentNumber: '22222222222' }),
    ).rejects.toThrow(ConflictException);
  });

  it('passes the legal name through split into first and last', async () => {
    const h = buildHarness(confirmed);

    await h.service.verifyIdentity('ent-1', { documentType: 'BVN', documentNumber: '22222222222' });

    expect((h.provider.verifyIdentity as jest.Mock).mock.calls[0][0]).toMatchObject({
      firstName: 'Patrick',
      lastName: 'Imohiosen',
    });
  });
});

describe('KycService.decideReview', () => {
  const inReview = makeEntertainer({
    ...BANK,
    resolvedAccountName: 'PATRICK IMOHIOSEN',
    accountConfirmedAt: new Date(),
    kycStatus: KycStatus.REVIEW,
  });

  it('approving verifies and enables payouts', async () => {
    const h = buildHarness(inReview);

    const view = await h.service.decideReview('ent-1', 'APPROVE', 'Documents checked', 'admin-1');

    expect(view.status).toBe(KycStatus.VERIFIED);
    expect(view.payoutsEnabled).toBe(true);
  });

  it('rejecting fails the entertainer and records why', async () => {
    const h = buildHarness(inReview);

    const view = await h.service.decideReview(
      'ent-1',
      'REJECT',
      'Documents did not match',
      'admin-1',
    );

    expect(view.status).toBe(KycStatus.FAILED);
    expect(view.failureReason).toContain('Documents did not match');
  });

  // Approving an unconfirmed destination would send money to an account nobody
  // checked belonged to them.
  it('refuses to approve when the bank account was never confirmed', async () => {
    const h = buildHarness(
      makeEntertainer({ ...BANK, kycStatus: KycStatus.REVIEW, accountConfirmedAt: null }),
    );

    await expect(
      h.service.decideReview('ent-1', 'APPROVE', 'Looks fine to me', 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('only applies to entertainers actually in REVIEW', async () => {
    const h = buildHarness(makeEntertainer({ kycStatus: KycStatus.PENDING }));

    await expect(
      h.service.decideReview('ent-1', 'APPROVE', 'Documents checked', 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('KycService.getStatus', () => {
  it('masks the account number to its last four digits', async () => {
    const h = buildHarness(makeEntertainer(BANK));

    const view = await h.service.getStatus('ent-1');

    expect(view.accountNumberMasked).toBe('******6789');
    expect(JSON.stringify(view)).not.toContain('0123456789');
  });
});

describe('helpers', () => {
  it.each([
    [makeEntertainer(), 'BANK_DETAILS'],
    [makeEntertainer(BANK), 'RESOLVE_ACCOUNT'],
    [makeEntertainer({ ...BANK, resolvedAccountName: 'X' }), 'CONFIRM_ACCOUNT'],
    [
      makeEntertainer({ ...BANK, resolvedAccountName: 'X', accountConfirmedAt: new Date() }),
      'VERIFY_IDENTITY',
    ],
    [makeEntertainer({ kycStatus: KycStatus.VERIFIED }), 'DONE'],
  ])('derives the next step from the record', (entertainer, expected) => {
    expect(nextStepFor(entertainer as never)).toBe(expected);
  });

  it('masks nothing when there is no account number', () => {
    expect(maskAccountNumber(null)).toBeNull();
  });

  it('normalizes names for comparison', () => {
    expect(normalizeName('  patrick   imohiosen ')).toBe('PATRICK IMOHIOSEN');
  });

  it.each([
    ['Patrick Imohiosen', { firstName: 'Patrick', lastName: 'Imohiosen' }],
    ['Damini Ebunoluwa Ogulu', { firstName: 'Damini', lastName: 'Ebunoluwa Ogulu' }],
    ['Wizkid', { firstName: 'Wizkid', lastName: 'Wizkid' }],
    ['', { firstName: '', lastName: '' }],
  ])('splits a legal name: %s', (input, expected) => {
    expect(splitLegalName(input)).toEqual(expected);
  });
});
