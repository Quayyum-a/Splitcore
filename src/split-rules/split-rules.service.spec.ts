import { Test, TestingModule } from '@nestjs/testing';
import { SplitRulesService } from './split-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('SplitRulesService', () => {
  let service: SplitRulesService;
  let prisma: PrismaService;

  const mockSplitRule = {
    id: 'rule-id-1',
    venueId: 'venue-id-1',
    entertainerBps: 7000,
    venueBps: 2500,
    platformBps: 500,
    effectiveFrom: new Date('2024-01-01'),
    effectiveTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    splitRule: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SplitRulesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SplitRulesService>(SplitRulesService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create first split rule for venue', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      };

      const newRule = { ...mockSplitRule, ...createDto };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          splitRule: {
            findFirst: jest.fn().mockResolvedValue(null), // No existing rule
            create: jest.fn().mockResolvedValue(newRule),
          },
        };
        return callback(tx);
      });

      const result = await service.create(createDto);

      expect(result).toEqual(newRule);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should close out existing rule and create new one in transaction', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerBps: 8000,
        venueBps: 1500,
        platformBps: 500,
      };

      const existingRule = { ...mockSplitRule };
      const newRule = {
        ...mockSplitRule,
        id: 'rule-id-2',
        ...createDto,
        effectiveFrom: new Date(),
      };

      let updateCalled = false;
      let createCalled = false;
      let updatedRuleEffectiveTo: Date | null = null;

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          splitRule: {
            findFirst: jest.fn().mockResolvedValue(existingRule),
            update: jest.fn().mockImplementation((args) => {
              updateCalled = true;
              updatedRuleEffectiveTo = args.data.effectiveTo;
              return Promise.resolve({ ...existingRule, effectiveTo: args.data.effectiveTo });
            }),
            create: jest.fn().mockImplementation((args) => {
              createCalled = true;
              return Promise.resolve(newRule);
            }),
          },
        };
        return callback(tx);
      });

      const result = await service.create(createDto);

      expect(result).toEqual(newRule);
      expect(updateCalled).toBe(true);
      expect(createCalled).toBe(true);
      expect(updatedRuleEffectiveTo).not.toBeNull();
      expect(updatedRuleEffectiveTo).toBeInstanceOf(Date);
    });

    it('should set effectiveFrom and effectiveTo correctly', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      };

      const existingRule = { ...mockSplitRule };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          splitRule: {
            findFirst: jest.fn().mockResolvedValue(existingRule),
            update: jest.fn().mockImplementation((args) => {
              // Verify effectiveTo is set to current time
              expect(args.data.effectiveTo).toBeInstanceOf(Date);
              return Promise.resolve({ ...existingRule, effectiveTo: args.data.effectiveTo });
            }),
            create: jest.fn().mockImplementation((args) => {
              // Verify new rule has effectiveFrom = now and effectiveTo = null
              expect(args.data.effectiveFrom).toBeInstanceOf(Date);
              expect(args.data.effectiveTo).toBeNull();
              return Promise.resolve({ ...mockSplitRule, id: 'new-id', ...args.data });
            }),
          },
        };
        return callback(tx);
      });

      await service.create(createDto);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('findAllByVenue', () => {
    it('should return all rules for venue in descending order', async () => {
      const rules = [
        {
          ...mockSplitRule,
          id: 'rule-2',
          effectiveFrom: new Date('2024-02-01'),
          effectiveTo: null,
        },
        {
          ...mockSplitRule,
          id: 'rule-1',
          effectiveFrom: new Date('2024-01-01'),
          effectiveTo: new Date('2024-02-01'),
        },
      ];

      mockPrismaService.splitRule.findMany.mockResolvedValue(rules);

      const result = await service.findAllByVenue('venue-id-1');

      expect(result).toEqual(rules);
      expect(mockPrismaService.splitRule.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-id-1' },
        orderBy: { effectiveFrom: 'desc' },
      });
    });

    it('should return empty array if no rules exist', async () => {
      mockPrismaService.splitRule.findMany.mockResolvedValue([]);

      const result = await service.findAllByVenue('venue-id-1');

      expect(result).toEqual([]);
    });
  });

  describe('findActiveByVenue', () => {
    it('should return active rule (effectiveTo is null)', async () => {
      mockPrismaService.splitRule.findFirst.mockResolvedValue(mockSplitRule);

      const result = await service.findActiveByVenue('venue-id-1');

      expect(result).toEqual(mockSplitRule);
      expect(mockPrismaService.splitRule.findFirst).toHaveBeenCalledWith({
        where: {
          venueId: 'venue-id-1',
          effectiveTo: null,
        },
      });
    });

    it('should throw NotFoundException if no active rule exists', async () => {
      mockPrismaService.splitRule.findFirst.mockResolvedValue(null);

      await expect(service.findActiveByVenue('venue-id-1')).rejects.toThrow(NotFoundException);
      await expect(service.findActiveByVenue('venue-id-1')).rejects.toThrow(
        'No active split rule found for venue venue-id-1',
      );
    });
  });
});
