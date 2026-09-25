import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaystackPayoutProvider } from './paystack-payout.provider';

describe('PaystackPayoutProvider', () => {
  let provider: PaystackPayoutProvider;
  let configService: ConfigService;

  const mockSecretKey = 'sk_test_mock_secret_key';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackPayoutProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'PAYSTACK_SECRET_KEY') return mockSecretKey;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<PaystackPayoutProvider>(PaystackPayoutProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('createRecipient', () => {
    it('should create transfer recipient successfully', async () => {
      const mockResponse = {
        status: true,
        data: {
          recipient_code: 'RCP_mock123',
          active: true,
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.createRecipient({
        type: 'nuban',
        name: 'John Doe',
        accountNumber: '0123456789',
        bankCode: '058', // GTBank
        currency: 'NGN',
      });

      expect(result).toEqual({
        recipientCode: 'RCP_mock123',
        active: true,
        raw: mockResponse.data,
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.paystack.co/transferrecipient',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockSecretKey}`,
          }),
        }),
      );
    });

    it('should throw error on failed recipient creation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid bank code' }),
      });

      await expect(
        provider.createRecipient({
          type: 'nuban',
          name: 'John Doe',
          accountNumber: '0123456789',
          bankCode: '999', // Invalid
          currency: 'NGN',
        }),
      ).rejects.toThrow('Paystack recipient creation failed');
    });
  });

  describe('initiateTransfer', () => {
    it('should initiate transfer successfully', async () => {
      const mockResponse = {
        status: true,
        data: {
          reference: 'transfer-ref-123',
          status: 'pending',
          amount: 425000, // ₦4,250 (entertainer's share)
          id: 67890,
          createdAt: '2026-09-25T10:00:00.000Z',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.initiateTransfer({
        amountKobo: 425000,
        recipientCode: 'RCP_mock123',
        reference: 'transfer-ref-123',
        reason: 'Tip payout',
        currency: 'NGN',
      });

      expect(result).toMatchObject({
        reference: 'transfer-ref-123',
        status: 'pending',
        amountKobo: 425000,
        providerTransferId: '67890',
      });
      expect(result.createdAt).toBeInstanceOf(Date);

      const fetchCall = (fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.source).toBe('balance');
      expect(body.reason).toBe('Tip payout');
    });

    it('should map transfer statuses correctly', async () => {
      const statuses = [
        { paystack: 'success', expected: 'success' },
        { paystack: 'failed', expected: 'failed' },
        { paystack: 'reversed', expected: 'reversed' },
        { paystack: 'pending', expected: 'pending' },
        { paystack: 'processing', expected: 'pending' },
      ];

      for (const { paystack, expected } of statuses) {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: 'transfer-ref-123',
              status: paystack,
              amount: 425000,
            },
          }),
        });

        const result = await provider.initiateTransfer({
          amountKobo: 425000,
          recipientCode: 'RCP_mock123',
          reference: 'transfer-ref-123',
          currency: 'NGN',
        });
        expect(result.status).toBe(expected);
      }
    });

    it('should include failure reason when transfer fails', async () => {
      const mockResponse = {
        status: true,
        data: {
          reference: 'transfer-ref-123',
          status: 'failed',
          amount: 425000,
          failure_reason: 'Invalid account number',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.initiateTransfer({
        amountKobo: 425000,
        recipientCode: 'RCP_mock123',
        reference: 'transfer-ref-123',
        currency: 'NGN',
      });

      expect(result.failureReason).toBe('Invalid account number');
    });

    it('should throw error on failed transfer initiation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Insufficient balance' }),
      });

      await expect(
        provider.initiateTransfer({
          amountKobo: 425000,
          recipientCode: 'RCP_mock123',
          reference: 'transfer-ref-123',
          currency: 'NGN',
        }),
      ).rejects.toThrow('Paystack transfer failed');
    });
  });

  describe('verifyTransfer', () => {
    it('should verify successful transfer', async () => {
      const mockResponse = {
        status: true,
        data: {
          reference: 'transfer-ref-123',
          status: 'success',
          amount: 425000,
          transferred_at: '2026-09-25T10:05:00.000Z',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.verifyTransfer('transfer-ref-123');

      expect(result).toMatchObject({
        reference: 'transfer-ref-123',
        status: 'success',
        amountKobo: 425000,
      });
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('should include failure reason in verification', async () => {
      const mockResponse = {
        status: true,
        data: {
          reference: 'transfer-ref-123',
          status: 'failed',
          amount: 425000,
          failure_reason: 'Account name mismatch',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.verifyTransfer('transfer-ref-123');

      expect(result.status).toBe('failed');
      expect(result.failureReason).toBe('Account name mismatch');
    });

    it('should throw error on failed verification', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Transfer not found' }),
      });

      await expect(provider.verifyTransfer('invalid-ref')).rejects.toThrow(
        'Paystack transfer verification failed',
      );
    });
  });
});
