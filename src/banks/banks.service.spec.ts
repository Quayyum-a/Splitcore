import { BadRequestException } from '@nestjs/common';
import { BanksService, normalizeBankName } from './banks.service';
import { KycProvider, ProviderBank } from '../kyc/interfaces/kyc-provider.interface';

/** Shaped like the real Paystack list, including the formal names it actually uses. */
const LIVE: ProviderBank[] = [
  { name: 'Guaranty Trust Bank', code: '058', active: true, supportsTransfer: true },
  { name: 'United Bank For Africa', code: '033', active: true, supportsTransfer: true },
  { name: 'First City Monument Bank', code: '214', active: true, supportsTransfer: true },
  { name: 'First Bank of Nigeria', code: '011', active: true, supportsTransfer: true },
  { name: 'Access Bank', code: '044', active: true, supportsTransfer: true },
  { name: 'Access Bank (Diamond)', code: '063', active: true, supportsTransfer: true },
  { name: 'Dead Bank', code: '111', active: false, supportsTransfer: true },
  { name: 'No Transfers Bank', code: '222', active: true, supportsTransfer: false },
];

function buildHarness(banks: ProviderBank[] = LIVE) {
  const provider = {
    name: 'paystack',
    listBanks: jest.fn().mockResolvedValue(banks),
    resolveAccount: jest.fn(),
    verifyIdentity: jest.fn(),
  } as unknown as KycProvider;
  return { service: new BanksService(provider), provider };
}

describe('BanksService.list', () => {
  it('drops banks a transfer could never reach', async () => {
    const h = buildHarness();

    const names = (await h.service.list()).map((b) => b.name);

    expect(names).not.toContain('Dead Bank');
    expect(names).not.toContain('No Transfers Bank');
  });

  it('sorts by name, so a picker is usable', async () => {
    const h = buildHarness();

    const names = (await h.service.list()).map((b) => b.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('caches, so the provider is not hit per request', async () => {
    const h = buildHarness();

    await h.service.list();
    await h.service.list();
    await h.service.list();

    expect(h.provider.listBanks).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent cold reads into one upstream call', async () => {
    const h = buildHarness();

    await Promise.all([h.service.list(), h.service.list(), h.service.list()]);

    expect(h.provider.listBanks).toHaveBeenCalledTimes(1);
  });

  // A day-old bank list is still a correct bank list; failing onboarding over a
  // provider blip is not.
  it('serves the stale list when a refresh fails', async () => {
    const h = buildHarness();
    await h.service.list();
    (h.provider.listBanks as jest.Mock).mockRejectedValue(new Error('paystack 503'));

    // Force expiry.
    (h.service as unknown as { cache: { fetchedAt: number } }).cache.fetchedAt = 0;

    const banks = await h.service.list();
    expect(banks.length).toBeGreaterThan(0);
  });

  it('falls back to the static map on a cold start with the provider down', async () => {
    const h = buildHarness();
    (h.provider.listBanks as jest.Mock).mockRejectedValue(new Error('paystack 503'));

    const banks = await h.service.list();

    expect(banks.length).toBeGreaterThan(0);
    expect(banks.every((b) => b.code)).toBe(true);
  });

  it('treats an empty provider list as a failure, not as "no banks exist"', async () => {
    const h = buildHarness([]);

    const banks = await h.service.list();

    expect(banks.length).toBeGreaterThan(0);
  });

  it('does not cache the fallback, so the next call retries the provider', async () => {
    const h = buildHarness();
    (h.provider.listBanks as jest.Mock).mockRejectedValueOnce(new Error('paystack 503'));

    await h.service.list();
    const second = await h.service.list();

    expect(h.provider.listBanks).toHaveBeenCalledTimes(2);
    expect(second.map((b) => b.name)).toContain('Guaranty Trust Bank');
  });
});

describe('BanksService.resolve', () => {
  it('accepts a code from the list', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankCode: '058' })).resolves.toEqual({
      name: 'Guaranty Trust Bank',
      code: '058',
    });
  });

  // The hazard this whole service exists to remove: a transposed digit used to be
  // a real but different bank, and the mistake surfaced as a transfer to a stranger.
  it('rejects a code that is not in the list', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankCode: '085' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a code for a bank that cannot receive transfers', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankCode: '222' })).rejects.toThrow(BadRequestException);
  });

  it('matches the exact formal name', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankName: 'Access Bank' })).resolves.toMatchObject({
      code: '044',
    });
  });

  it('ignores case, spacing and suffixes like Plc', async () => {
    const h = buildHarness();

    await expect(
      h.service.resolve({ bankName: '  guaranty   trust bank Plc ' }),
    ).resolves.toMatchObject({ code: '058' });
  });

  // The colloquial names nobody would think to type formally. Without the alias
  // layer these are all 400s, which would make the feature useless in practice.
  it.each([
    ['GTBank', '058'],
    ['UBA', '033'],
    ['FCMB', '214'],
    ['First Bank', '011'],
  ])('resolves the colloquial name %s', async (name, code) => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankName: name })).resolves.toMatchObject({ code });
  });

  // Two plausible destinations is exactly when guessing is unforgivable.
  it('refuses an ambiguous name and names the candidates', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankName: 'Access' })).rejects.toThrow(/matches 2 banks/);
  });

  it('refuses a name that matches nothing', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({ bankName: 'Bank of Nowhere' })).rejects.toThrow(
      /not a recognised bank/,
    );
  });

  it('requires at least one of name or code', async () => {
    const h = buildHarness();

    await expect(h.service.resolve({})).rejects.toThrow(BadRequestException);
  });

  it('prefers the code when both are given, since it is unambiguous', async () => {
    const h = buildHarness();

    await expect(
      h.service.resolve({ bankCode: '044', bankName: 'Guaranty Trust Bank' }),
    ).resolves.toMatchObject({ code: '044' });
  });
});

describe('normalizeBankName', () => {
  it.each([
    ['GTBank', 'GTBANK'],
    ['Guaranty Trust Bank Plc', 'GUARANTY TRUST BANK'],
    ['First  Bank, Ltd.', 'FIRST BANK'],
    ["St. Peter's Bank", 'ST PETERS BANK'],
    ['Access Bank (Diamond)', 'ACCESS BANK DIAMOND'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBankName(input)).toBe(expected);
  });
});
