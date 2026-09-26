import { ConfigService } from '@nestjs/config';
import { AccountResolutionError, PaystackKycProvider } from './paystack-kyc.provider';

function buildProvider(secretKey: string | undefined = 'sk_test_mock') {
  const configService = {
    get: jest.fn((key: string) => (key === 'PAYSTACK_SECRET_KEY' ? secretKey : undefined)),
  } as unknown as ConfigService;
  return new PaystackKycProvider(configService);
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PaystackKycProvider.resolveAccount', () => {
  it("returns the account holder's name as the bank reports it", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        data: { account_number: '0123456789', account_name: 'PATRICK IMOHIOSEN' },
      }),
    );

    const result = await buildProvider().resolveAccount('0123456789', '058');

    expect(result).toEqual({
      accountNumber: '0123456789',
      bankCode: '058',
      accountName: 'PATRICK IMOHIOSEN',
    });
  });

  it('percent-encodes the query so a crafted account number cannot alter the request', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: true, data: { account_name: 'X' } }));

    await buildProvider().resolveAccount('01&bank_code=999', '058');

    const url = (fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('account_number=01%26bank_code%3D999');
    expect(url).toContain('bank_code=058');
  });

  // The provider's own wording ("Cannot resolve account", "Invalid bank code") is
  // the useful part, so it is surfaced rather than replaced with something vague.
  it('raises AccountResolutionError carrying the provider message', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(422, { status: false, message: 'Cannot resolve account' }));

    await expect(buildProvider().resolveAccount('0000000000', '058')).rejects.toThrow(
      AccountResolutionError,
    );
    await expect(buildProvider().resolveAccount('0000000000', '058')).rejects.toThrow(
      'Cannot resolve account',
    );
  });

  it('treats a 200 with no account name as a failure, not a blank name', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { status: true, data: {} }));

    await expect(buildProvider().resolveAccount('0000000000', '058')).rejects.toThrow(
      AccountResolutionError,
    );
  });

  it('survives a non-JSON body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(buildProvider().resolveAccount('0000000000', '058')).rejects.toThrow(
      AccountResolutionError,
    );
  });
});

describe('PaystackKycProvider.verifyIdentity', () => {
  const params = {
    documentType: 'BVN' as const,
    documentNumber: '22222222222',
    firstName: 'Patrick',
    lastName: 'Imohiosen',
    accountNumber: '0123456789',
    bankCode: '058',
  };

  // The finding this whole branch of the code exists for: Paystack answers 404
  // on accounts without the CAC-registered "Registered Business" tier. Calling
  // that a failed check would tell a legitimate entertainer they failed
  // something that never ran.
  it('maps 404 to unavailable, not failed, and names the tier requirement', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(404, {}));

    const result = await buildProvider().verifyIdentity(params);

    expect(result.outcome).toBe('unavailable');
    expect(result.reason).toContain('Registered Business');
  });

  it('maps a network failure to unavailable, not failed', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    const result = await buildProvider().verifyIdentity(params);

    expect(result.outcome).toBe('unavailable');
  });

  it('reports verified when both names match', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        data: { first_name: true, last_name: true, is_blacklisted: false },
      }),
    );

    await expect(buildProvider().verifyIdentity(params)).resolves.toEqual({ outcome: 'verified' });
  });

  it('reports failed on a name mismatch', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: true, data: { first_name: true, last_name: false } }),
      );

    const result = await buildProvider().verifyIdentity(params);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('does not match');
  });

  it('reports failed for a blacklisted document even when the names match', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        data: { first_name: true, last_name: true, is_blacklisted: true },
      }),
    );

    const result = await buildProvider().verifyIdentity(params);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('blacklisted');
  });

  it('reports failed with the provider message on a rejected request', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { status: false, message: 'Invalid BVN' }));

    await expect(buildProvider().verifyIdentity(params)).resolves.toEqual({
      outcome: 'failed',
      reason: 'Invalid BVN',
    });
  });

  // The compliance constraint: the number goes to the provider and nowhere else.
  // Nothing this method returns may carry it.
  it('never returns the identity number', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: true, data: { first_name: false, last_name: false } }),
      );

    const result = await buildProvider().verifyIdentity(params);

    expect(JSON.stringify(result)).not.toContain('22222222222');
  });

  it('sends the number to the provider and nowhere else', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: true, data: { first_name: true, last_name: true } }),
      );

    await buildProvider().verifyIdentity(params);

    const [url, init] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.paystack.co/identity/bvn/match');
    expect(JSON.parse(init.body).bvn).toBe('22222222222');
  });
});

describe('PaystackKycProvider configuration', () => {
  it('warns rather than throwing when no secret key is set', () => {
    expect(() => buildProvider(undefined)).not.toThrow();
    expect(buildProvider(undefined).name).toBe('paystack');
  });
});
