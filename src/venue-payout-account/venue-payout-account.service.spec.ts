import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BanksService } from '../banks/banks.service';
import { KycProvider } from '../kyc/interfaces/kyc-provider.interface';
import { AccountResolutionError } from '../kyc/providers/paystack-kyc.provider';
import { VenuePayoutAccountService, nextStepFor } from './venue-payout-account.service';

function makeVenue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'venue-1',
    name: 'Quilox',
    slug: 'quilox',
    logoUrl: null,
    location: 'Lagos',
    isActive: true,
    bankName: null,
    bankCode: null,
    accountNumber: null,
    resolvedAccountName: null,
    accountResolvedAt: null,
    accountConfirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildHarness(venue = makeVenue()) {
  const prisma = {
    venue: {
      findUnique: jest.fn().mockResolvedValue(venue),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...venue, ...data })),
    },
  };
  const provider = {
    name: 'paystack',
    listBanks: jest.fn(),
    resolveAccount: jest.fn().mockResolvedValue({
      accountNumber: '0123456789',
      bankCode: '058',
      accountName: 'QUILOX ENTERTAINMENT LIMITED',
    }),
    verifyIdentity: jest.fn(),
  } as unknown as KycProvider;
  const banks = {
    resolve: jest.fn().mockResolvedValue({ name: 'Guaranty Trust Bank', code: '058' }),
  } as unknown as BanksService;

  const service = new VenuePayoutAccountService(
    prisma as unknown as PrismaService,
    provider,
    banks,
  );
  return { service, prisma, provider, banks };
}

const BANK = { bankName: 'GTBank', accountNumber: '0123456789' };

describe('VenuePayoutAccountService.submitBankDetails', () => {
  it("stores the bank's formal name and code from the resolved list", async () => {
    const h = buildHarness();

    const view = await h.service.submitBankDetails('venue-1', BANK);

    const data = h.prisma.venue.update.mock.calls[0][0].data;
    expect(data.bankName).toBe('Guaranty Trust Bank');
    expect(data.bankCode).toBe('058');
    expect(view.nextStep).toBe('RESOLVE_ACCOUNT');
  });

  // Same rule as the entertainer flow: passing the name check on one account and
  // swapping the number underneath must not be possible.
  it('clears a prior resolution and confirmation when the account changes', async () => {
    const h = buildHarness(
      makeVenue({
        accountNumber: '9999999999',
        bankCode: '058',
        resolvedAccountName: 'SOMEONE ELSE',
        accountConfirmedAt: new Date(),
      }),
    );

    await h.service.submitBankDetails('venue-1', BANK);

    const data = h.prisma.venue.update.mock.calls[0][0].data;
    expect(data.resolvedAccountName).toBeNull();
    expect(data.accountConfirmedAt).toBeNull();
  });

  it('keeps an existing confirmation when the details are unchanged', async () => {
    const confirmed = new Date('2026-01-01T00:00:00Z');
    const h = buildHarness(
      makeVenue({
        accountNumber: '0123456789',
        bankCode: '058',
        resolvedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
        accountConfirmedAt: confirmed,
      }),
    );

    await h.service.submitBankDetails('venue-1', BANK);

    expect(h.prisma.venue.update.mock.calls[0][0].data.accountConfirmedAt).toBeUndefined();
  });

  it('lets an unresolvable bank surface as a 400 from BanksService', async () => {
    const h = buildHarness();
    (h.banks.resolve as jest.Mock).mockRejectedValue(new BadRequestException('Unknown bank'));

    await expect(h.service.submitBankDetails('venue-1', BANK)).rejects.toThrow(BadRequestException);
  });

  it('404s for an unknown venue', async () => {
    const h = buildHarness();
    h.prisma.venue.findUnique.mockResolvedValue(null);

    await expect(h.service.submitBankDetails('nope', BANK)).rejects.toThrow(NotFoundException);
  });
});

describe('VenuePayoutAccountService.resolveAccount', () => {
  const withBank = makeVenue({
    bankName: 'Guaranty Trust Bank',
    bankCode: '058',
    accountNumber: '0123456789',
  });

  it("stores the bank's name, not anything typed", async () => {
    const h = buildHarness(withBank);

    const view = await h.service.resolveAccount('venue-1');

    expect(view.resolvedAccountName).toBe('QUILOX ENTERTAINMENT LIMITED');
    expect(view.nextStep).toBe('CONFIRM_ACCOUNT');
  });

  it('invalidates a previous confirmation', async () => {
    const h = buildHarness(makeVenue({ ...withBank, accountConfirmedAt: new Date() }));

    await h.service.resolveAccount('venue-1');

    expect(h.prisma.venue.update.mock.calls[0][0].data.accountConfirmedAt).toBeNull();
  });

  it('requires bank details first', async () => {
    const h = buildHarness();

    await expect(h.service.resolveAccount('venue-1')).rejects.toThrow(BadRequestException);
  });

  it('answers 400 when the bank rejects the details', async () => {
    const h = buildHarness(withBank);
    (h.provider.resolveAccount as jest.Mock).mockRejectedValue(
      new AccountResolutionError('Cannot resolve account'),
    );

    await expect(h.service.resolveAccount('venue-1')).rejects.toThrow(BadRequestException);
  });

  it('lets an unexpected provider error surface rather than calling it a bad account', async () => {
    const h = buildHarness(withBank);
    (h.provider.resolveAccount as jest.Mock).mockRejectedValue(new Error('socket hang up'));

    await expect(h.service.resolveAccount('venue-1')).rejects.toThrow('socket hang up');
  });
});

describe('VenuePayoutAccountService.confirmAccount', () => {
  const resolved = makeVenue({
    bankName: 'Guaranty Trust Bank',
    bankCode: '058',
    accountNumber: '0123456789',
    resolvedAccountName: 'QUILOX ENTERTAINMENT LIMITED',
  });

  it('enables payouts once the name matches', async () => {
    const h = buildHarness(resolved);

    const view = await h.service.confirmAccount('venue-1', 'QUILOX ENTERTAINMENT LIMITED');

    expect(view.accountConfirmedAt).not.toBeNull();
    expect(view.payoutsEnabled).toBe(true);
    expect(view.nextStep).toBe('DONE');
  });

  it('ignores case and spacing', async () => {
    const h = buildHarness(resolved);

    await expect(
      h.service.confirmAccount('venue-1', '  quilox   entertainment limited '),
    ).resolves.toBeDefined();
  });

  it('rejects a name the bank never returned', async () => {
    const h = buildHarness(resolved);

    await expect(h.service.confirmAccount('venue-1', 'Someone Else Ltd')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires resolution first', async () => {
    const h = buildHarness(
      makeVenue({ bankName: 'GTB', bankCode: '058', accountNumber: '0123456789' }),
    );

    await expect(h.service.confirmAccount('venue-1', 'Anything')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('VenuePayoutAccountService.getStatus', () => {
  it('masks the account number', async () => {
    const h = buildHarness(
      makeVenue({ bankCode: '058', accountNumber: '0123456789', bankName: 'GTB' }),
    );

    const view = await h.service.getStatus('venue-1');

    expect(view.accountNumberMasked).toBe('******6789');
    expect(JSON.stringify(view)).not.toContain('0123456789');
  });

  it('reports payoutsEnabled false until confirmed', async () => {
    const h = buildHarness(
      makeVenue({ bankCode: '058', accountNumber: '0123456789', resolvedAccountName: 'X' }),
    );

    expect((await h.service.getStatus('venue-1')).payoutsEnabled).toBe(false);
  });
});

describe('nextStepFor', () => {
  it.each([
    [makeVenue(), 'BANK_DETAILS'],
    [makeVenue({ bankCode: '058', accountNumber: '0123456789' }), 'RESOLVE_ACCOUNT'],
    [
      makeVenue({ bankCode: '058', accountNumber: '0123456789', resolvedAccountName: 'X' }),
      'CONFIRM_ACCOUNT',
    ],
    [
      makeVenue({
        bankCode: '058',
        accountNumber: '0123456789',
        resolvedAccountName: 'X',
        accountConfirmedAt: new Date(),
      }),
      'DONE',
    ],
  ])('derives the next step', (venue, expected) => {
    expect(nextStepFor(venue as never)).toBe(expected);
  });
});
