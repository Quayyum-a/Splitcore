import { Test, TestingModule } from '@nestjs/testing';
import { EntertainersController } from './entertainers.controller';
import { EntertainersService } from './entertainers.service';
import { KycStatus, Role } from '@prisma/client';

describe('EntertainersController', () => {
  let controller: EntertainersController;
  let service: EntertainersService;

  const mockEntertainer = {
    id: 'entertainer-id-1',
    stageName: 'DJ Neptune',
    legalName: 'Patrick Imohiosen',
    phone: '+2348012345678',
    bankName: 'GTBank',
    accountNumber: '0123456789',
    kycStatus: KycStatus.NOT_STARTED,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    venueIds: ['venue-id-1'],
  };

  const mockEntertainersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    linkToVenue: jest.fn(),
    unlinkFromVenue: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 'user-id-1',
      role: Role.PLATFORM_ADMIN,
      venueId: null,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EntertainersController],
      providers: [
        {
          provide: EntertainersService,
          useValue: mockEntertainersService,
        },
      ],
    }).compile();

    controller = module.get<EntertainersController>(EntertainersController);
    service = module.get<EntertainersService>(EntertainersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an entertainer', async () => {
      const createDto = {
        stageName: 'DJ Neptune',
        legalName: 'Patrick Imohiosen',
        phone: '+2348012345678',
        bankName: 'GTBank',
        accountNumber: '0123456789',
      };

      mockEntertainersService.create.mockResolvedValue(mockEntertainer);

      const result = await controller.create(createDto);

      expect(result).toEqual(mockEntertainer);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should return all entertainers', async () => {
      const entertainers = [mockEntertainer];
      mockEntertainersService.findAll.mockResolvedValue(entertainers);

      const result = await controller.findAll(mockRequest);

      expect(result).toEqual(entertainers);
      expect(service.findAll).toHaveBeenCalledWith(mockRequest.user.id, mockRequest.user.role);
    });
  });

  describe('findOne', () => {
    it('should return an entertainer by ID', async () => {
      mockEntertainersService.findOne.mockResolvedValue(mockEntertainer);

      const result = await controller.findOne('entertainer-id-1');

      expect(result).toEqual(mockEntertainer);
      expect(service.findOne).toHaveBeenCalledWith('entertainer-id-1');
    });
  });

  describe('update', () => {
    it('should update an entertainer', async () => {
      const updateDto = { stageName: 'DJ Updated' };
      const updatedEntertainer = { ...mockEntertainer, stageName: 'DJ Updated' };

      mockEntertainersService.update.mockResolvedValue(updatedEntertainer);

      const result = await controller.update('entertainer-id-1', updateDto);

      expect(result).toEqual(updatedEntertainer);
      expect(service.update).toHaveBeenCalledWith('entertainer-id-1', updateDto);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an entertainer', async () => {
      const deactivatedEntertainer = { ...mockEntertainer, isActive: false };
      mockEntertainersService.deactivate.mockResolvedValue(deactivatedEntertainer);

      const result = await controller.deactivate('entertainer-id-1');

      expect(result).toEqual(deactivatedEntertainer);
      expect(result.isActive).toBe(false);
      expect(service.deactivate).toHaveBeenCalledWith('entertainer-id-1');
    });
  });

  describe('linkToVenue', () => {
    it('should link entertainer to venue', async () => {
      const mockLink = {
        id: 'link-id-1',
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        createdAt: new Date(),
      };

      mockEntertainersService.linkToVenue.mockResolvedValue(mockLink);

      const result = await controller.linkToVenue('entertainer-id-1', 'venue-id-1');

      expect(result).toEqual({ message: 'Entertainer linked to venue successfully' });
      expect(service.linkToVenue).toHaveBeenCalledWith('entertainer-id-1', 'venue-id-1');
    });
  });

  describe('unlinkFromVenue', () => {
    it('should unlink entertainer from venue', async () => {
      mockEntertainersService.unlinkFromVenue.mockResolvedValue(undefined);

      const result = await controller.unlinkFromVenue('entertainer-id-1', 'venue-id-1');

      expect(result).toEqual({ message: 'Entertainer unlinked from venue successfully' });
      expect(service.unlinkFromVenue).toHaveBeenCalledWith('entertainer-id-1', 'venue-id-1');
    });
  });
});
