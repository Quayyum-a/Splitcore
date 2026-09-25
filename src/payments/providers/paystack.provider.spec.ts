import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaystackProvider } from './paystack.provider';
import * as crypto from 'crypto';

describe('PaystackProvider', () => {
  let provider: PaystackProvider;
  let configService: ConfigService;

  const mockSecretKey = 'sk_test_mock_secret_key';
  const mockPublicKey = 'pk_test_mock_public_key';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'PAYSTACK_SECRET_KEY') return mockSecretKey;
              if (key === 'PAYSTACK_PUBLIC_KEY') return mockPublicKey;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<PaystackProvider>(PaystackProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('initializePayment', () => {
    it('should initialize payment and return authorization URL', async () => {
      const mockResponse = {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/mock-url',
          access_code: 'mock-access-code',
          reference: 'ref-123',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.initializePayment({
        reference: 'ref-123',
        amountKobo: 500000, // ₦5,000
        email: 'guest@test.com',
      });

      expect(result).toEqual({
        authorizationUrl: 'https://checkout.paystack.com/mock-url',
        accessCode: 'mock-access-code',
        reference: 'ref-123',
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/initialize',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockSecretKey}`,
          }),
        }),
      );
    });

    it('should use default email if not provided', async () => {
      const mockResponse = {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/mock-url',
          access_code: 'mock-access-code',
          reference: 'ref-123',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await provider.initializePayment({
        reference: 'ref-123',
        amountKobo: 500000,
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.email).toBe('guest@splitcore.app');
    });

    it('should throw error on failed initialization', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid reference' }),
      });

      await expect(
        provider.initializePayment({
          reference: 'ref-123',
          amountKobo: 500000,
        }),
      ).rejects.toThrow('Paystack initialization failed');
    });
  });

  describe('verifyPayment', () => {
    it('should verify successful payment', async () => {
      const mockResponse = {
        status: true,
        data: {
          reference: 'ref-123',
          status: 'success',
          amount: 500000,
          id: 12345,
          paid_at: '2026-09-25T10:00:00.000Z',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.verifyPayment('ref-123');

      expect(result).toMatchObject({
        reference: 'ref-123',
        status: 'success',
        amountKobo: 500000,
        providerReference: '12345',
      });
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('should map Paystack statuses correctly', async () => {
      const statuses = [
        { paystack: 'success', expected: 'success' },
        { paystack: 'failed', expected: 'failed' },
        { paystack: 'abandoned', expected: 'abandoned' },
        { paystack: 'processing', expected: 'pending' },
      ];

      for (const { paystack, expected } of statuses) {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: 'ref-123',
              status: paystack,
              amount: 500000,
            },
          }),
        });

        const result = await provider.verifyPayment('ref-123');
        expect(result.status).toBe(expected);
      }
    });

    it('should throw error on failed verification', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Transaction not found' }),
      });

      await expect(provider.verifyPayment('invalid-ref')).rejects.toThrow(
        'Paystack verification failed',
      );
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const hash = crypto.createHmac('sha512', mockSecretKey).update(payload).digest('hex');

      const isValid = provider.verifyWebhookSignature(payload, hash);
      expect(isValid).toBe(true);
    });

    it('should reject invalid webhook signature', () => {
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const invalidHash = 'invalid-hash';

      const isValid = provider.verifyWebhookSignature(payload, invalidHash);
      expect(isValid).toBe(false);
    });

    it('should reject tampered payload', () => {
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const hash = crypto.createHmac('sha512', mockSecretKey).update(payload).digest('hex');

      // Tamper with payload
      const tamperedPayload = Buffer.from(JSON.stringify({ event: 'charge.failed' }));

      const isValid = provider.verifyWebhookSignature(tamperedPayload, hash);
      expect(isValid).toBe(false);
    });

    it('should handle errors gracefully', () => {
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      // Pass invalid signature format that might cause crypto errors
      const isValid = provider.verifyWebhookSignature(payload, null as any);
      expect(isValid).toBe(false);
    });

    it('should reject a malformed (non-hex / wrong length) signature without throwing', () => {
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      expect(provider.verifyWebhookSignature(payload, 'not-hex')).toBe(false);
      expect(provider.verifyWebhookSignature(payload, 'abcd')).toBe(false);
    });

    it('should reject everything when no secret key is configured', () => {
      // HMAC with an empty key is computable by anyone, so it must not verify.
      const unconfigured = new PaystackProvider({
        get: () => undefined,
      } as unknown as ConfigService);
      const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const forged = crypto.createHmac('sha512', '').update(payload).digest('hex');

      expect(unconfigured.verifyWebhookSignature(payload, forged)).toBe(false);
    });
  });
});
