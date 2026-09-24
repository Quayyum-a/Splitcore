import { Test, TestingModule } from '@nestjs/testing';
import { SplitRulesController } from './split-rules.controller';
import { SplitRulesService } from './split-rules.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';

describe('SplitRulesController', () => {
  let controller: SplitRulesController;
  let service: SplitRulesService;

  const mockSplitRule = {
    id: 'rule-id-1',
    venueId: 'venue-id-1',
    entertainerBps: 7000,
    venueBps: 2500,
    platformBps: 500,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSplitRulesService = {
    create: jest.fn(),
    findAllByVenue: jest.fn(),
    findActiveByVenue: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SplitRulesController],
      providers: [
        {
          provide: SplitRulesService,
          useValue: mockSplitRulesService,
        },
      ],
    }).compile();

    controller = module.get<SplitRulesController>(SplitRulesController);
    service = module.get<SplitRulesService>(SplitRulesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a split rule', async () => {
      const createDto: CreateSplitRuleDto = {
        venueId: 'venue-id-1',
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
      };

      mockSplitRulesService.create.mockResolvedValue(mockSplitRule);

      const result = await controller.create(createDto);

      expect(service.create).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(mockSplitRule);
    });
  });

  describe('findAllByVenue', () => {
    it('should return all rules for venue', async () => {
      const rules = [mockSplitRule];
      mockSplitRulesService.findAllByVenue.mockResolvedValue(rules);

      const result = await controller.findAllByVenue('venue-id-1');

      expect(service.findAllByVenue).toHaveBeenCalledWith('venue-id-1');
      expect(result).toEqual(rules);
    });
  });

  describe('findActiveByVenue', () => {
    it('should return active rule', async () => {
      mockSplitRulesService.findActiveByVenue.mockResolvedValue(mockSplitRule);

      const result = await controller.findActiveByVenue('venue-id-1');

      expect(service.findActiveByVenue).toHaveBeenCalledWith('venue-id-1');
      expect(result).toEqual(mockSplitRule);
    });
  });
});
