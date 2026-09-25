import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentTransaction, SplitRule } from '@prisma/client';

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: PrismaService;

  const mockPrisma = {
    ledgerAccount: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeLedgerEntries', () => {
    it('should compute balanced entries for entertainer tip at 85/10/5 split', () => {
      const payment: PaymentTransaction = {
        id: 'payment-123',
        externalReference: 'pay_abc',
        provider: 'paystack',
        venueId: 'venue-123',
        entertainerId: 'entertainer-123',
        guestSessionId: 'session-123',
        grossAmountKobo: 500000, // ₦5,000
        guestDisplayName: null,
        displayNameEnabled: false,
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentTransaction;

      const splitRule: SplitRule = {
        id: 'split-123',
        venueId: 'venue-123',
        entertainerBps: 8500, // 85%
        venueBps: 1000, // 10%
        platformBps: 500, // 5%
        effectiveFrom: new Date(),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SplitRule;

      const entries = service.computeLedgerEntries(payment, splitRule);

      // Should have 4 entries: 1 debit, 3 credits
      expect(entries).toHaveLength(4);

      // DEBIT: Processor clearing
      const debit = entries.find(
        (e) => e.accountType === 'PROCESSOR_CLEARING' && e.direction === 'DEBIT',
      );
      expect(debit).toBeDefined();
      expect(debit!.amountKobo).toBe(500000);
      expect(debit!.ownerId).toBeNull();

      // CREDIT: Entertainer payable (85% = ₦4,250)
      const entertainerCredit = entries.find(
        (e) => e.accountType === 'ENTERTAINER_PAYABLE' && e.direction === 'CREDIT',
      );
      expect(entertainerCredit).toBeDefined();
      expect(entertainerCredit!.amountKobo).toBe(425000);
      expect(entertainerCredit!.ownerId).toBe('entertainer-123');

      // CREDIT: Venue payable (10% = ₦500)
      const venueCredit = entries.find(
        (e) => e.accountType === 'VENUE_PAYABLE' && e.direction === 'CREDIT',
      );
      expect(venueCredit).toBeDefined();
      expect(venueCredit!.amountKobo).toBe(50000);
      expect(venueCredit!.ownerId).toBe('venue-123');

      // CREDIT: Platform revenue (5% = ₦250)
      const platformCredit = entries.find(
        (e) => e.accountType === 'PLATFORM_REVENUE' && e.direction === 'CREDIT',
      );
      expect(platformCredit).toBeDefined();
      expect(platformCredit!.amountKobo).toBe(25000);
      expect(platformCredit!.ownerId).toBeNull();

      // Verify balance: total debits = total credits
      const totalDebits = entries
        .filter((e) => e.direction === 'DEBIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      const totalCredits = entries
        .filter((e) => e.direction === 'CREDIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      expect(totalDebits).toBe(totalCredits);
      expect(totalDebits).toBe(500000);
    });

    it('should compute entries for venue-only tip (no entertainer)', () => {
      const payment: PaymentTransaction = {
        id: 'payment-123',
        externalReference: 'pay_abc',
        provider: 'paystack',
        venueId: 'venue-123',
        entertainerId: null, // No entertainer
        guestSessionId: 'session-123',
        grossAmountKobo: 200000, // ₦2,000
        guestDisplayName: null,
        displayNameEnabled: false,
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentTransaction;

      const splitRule: SplitRule = {
        id: 'split-123',
        venueId: 'venue-123',
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
        effectiveFrom: new Date(),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SplitRule;

      const entries = service.computeLedgerEntries(payment, splitRule);

      // Should have 3 entries: 1 debit, 2 credits (no entertainer entry)
      expect(entries).toHaveLength(3);

      // No entertainer entry
      const entertainerEntry = entries.find((e) => e.accountType === 'ENTERTAINER_PAYABLE');
      expect(entertainerEntry).toBeUndefined();

      // Venue gets venue share + entertainer share (95%)
      const venueCredit = entries.find(
        (e) => e.accountType === 'VENUE_PAYABLE' && e.direction === 'CREDIT',
      );
      expect(venueCredit).toBeDefined();
      expect(venueCredit!.amountKobo).toBe(190000); // 95% of ₦2,000 = ₦1,900

      // Platform gets its 5%
      const platformCredit = entries.find(
        (e) => e.accountType === 'PLATFORM_REVENUE' && e.direction === 'CREDIT',
      );
      expect(platformCredit).toBeDefined();
      expect(platformCredit!.amountKobo).toBe(10000); // 5% of ₦2,000 = ₦100

      // Verify balance
      const totalDebits = entries
        .filter((e) => e.direction === 'DEBIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      const totalCredits = entries
        .filter((e) => e.direction === 'CREDIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      expect(totalDebits).toBe(totalCredits);
      expect(totalDebits).toBe(200000);
    });

    it('should handle different split configurations correctly', () => {
      const payment: PaymentTransaction = {
        id: 'payment-123',
        externalReference: 'pay_abc',
        provider: 'paystack',
        venueId: 'venue-123',
        entertainerId: 'entertainer-123',
        guestSessionId: 'session-123',
        grossAmountKobo: 1000000, // ₦10,000
        guestDisplayName: null,
        displayNameEnabled: false,
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentTransaction;

      const splitRule: SplitRule = {
        id: 'split-123',
        venueId: 'venue-123',
        entertainerBps: 9000, // 90%
        venueBps: 800, // 8%
        platformBps: 200, // 2%
        effectiveFrom: new Date(),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SplitRule;

      const entries = service.computeLedgerEntries(payment, splitRule);

      const entertainerCredit = entries.find((e) => e.accountType === 'ENTERTAINER_PAYABLE');
      const venueCredit = entries.find((e) => e.accountType === 'VENUE_PAYABLE');
      const platformCredit = entries.find((e) => e.accountType === 'PLATFORM_REVENUE');

      expect(entertainerCredit!.amountKobo).toBe(900000); // 90%
      expect(venueCredit!.amountKobo).toBe(80000); // 8%
      expect(platformCredit!.amountKobo).toBe(20000); // 2%

      // Total = 1,000,000
      const totalCredits =
        entertainerCredit!.amountKobo + venueCredit!.amountKobo + platformCredit!.amountKobo;
      expect(totalCredits).toBe(1000000);
    });

    it('should throw error for invalid split rule (basis points != 10000)', () => {
      const payment: PaymentTransaction = {
        id: 'payment-123',
        externalReference: 'pay_abc',
        provider: 'paystack',
        venueId: 'venue-123',
        entertainerId: 'entertainer-123',
        guestSessionId: 'session-123',
        grossAmountKobo: 500000,
        guestDisplayName: null,
        displayNameEnabled: false,
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentTransaction;

      const invalidSplitRule: SplitRule = {
        id: 'split-123',
        venueId: 'venue-123',
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 600, // Total = 10100 (invalid!)
        effectiveFrom: new Date(),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SplitRule;

      expect(() => service.computeLedgerEntries(payment, invalidSplitRule)).toThrow(
        BadRequestException,
      );
    });

    it('should use integer arithmetic without floats', () => {
      // Test a case that might lose precision with float arithmetic
      const payment: PaymentTransaction = {
        id: 'payment-123',
        externalReference: 'pay_abc',
        provider: 'paystack',
        venueId: 'venue-123',
        entertainerId: 'entertainer-123',
        guestSessionId: 'session-123',
        grossAmountKobo: 333333, // Odd amount
        guestDisplayName: null,
        displayNameEnabled: false,
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentTransaction;

      const splitRule: SplitRule = {
        id: 'split-123',
        venueId: 'venue-123',
        entertainerBps: 8500,
        venueBps: 1000,
        platformBps: 500,
        effectiveFrom: new Date(),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SplitRule;

      const entries = service.computeLedgerEntries(payment, splitRule);

      // All amounts must be integers
      entries.forEach((entry) => {
        expect(Number.isInteger(entry.amountKobo)).toBe(true);
      });

      // Must still balance
      const totalDebits = entries
        .filter((e) => e.direction === 'DEBIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      const totalCredits = entries
        .filter((e) => e.direction === 'CREDIT')
        .reduce((sum, e) => sum + e.amountKobo, 0);
      expect(totalDebits).toBe(totalCredits);
    });
  });

  describe('getAccountBalance', () => {
    it('should calculate balance correctly for account with entries', async () => {
      mockPrisma.ledgerAccount.findUnique.mockResolvedValue({
        id: 'account-123',
        type: 'ENTERTAINER_PAYABLE',
        ownerId: 'entertainer-123',
        entries: [
          { direction: 'CREDIT', amountKobo: 425000 },
          { direction: 'CREDIT', amountKobo: 300000 },
          { direction: 'DEBIT', amountKobo: 200000 }, // Payout
        ],
      });

      const balance = await service.getAccountBalance('ENTERTAINER_PAYABLE', 'entertainer-123');

      // Credits - Debits = 725000 - 200000 = 525000
      expect(balance).toBe(525000);
    });

    it('should return 0 for non-existent account', async () => {
      mockPrisma.ledgerAccount.findUnique.mockResolvedValue(null);

      const balance = await service.getAccountBalance('ENTERTAINER_PAYABLE', 'entertainer-999');

      expect(balance).toBe(0);
    });

    it('should return 0 for account with no entries', async () => {
      mockPrisma.ledgerAccount.findUnique.mockResolvedValue({
        id: 'account-123',
        type: 'VENUE_PAYABLE',
        ownerId: 'venue-123',
        entries: [],
      });

      const balance = await service.getAccountBalance('VENUE_PAYABLE', 'venue-123');

      expect(balance).toBe(0);
    });
  });
});
