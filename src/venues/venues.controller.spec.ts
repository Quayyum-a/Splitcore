import { Test, TestingModule } from '@nestjs/testing';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { Role } from '@prisma/client';

describe('VenuesController', () => {
  let controller: VenuesController;
  let service: VenuesService;

  const mockVenue = {
    id: 'venue-id-1',
    name: 'Test Venue',
    slug: 'test-venue',
    logoUrl: 'https://example.com/logo.png',
    location: 'Test Location',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVenuesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VenuesController],
      providers: [
        {
          provide: VenuesService,
          useValue: mockVenuesService,
        },
      ],
    }).compile();

    controller = module.get<VenuesController>(VenuesController);
    service = module.get<VenuesService>(VenuesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call venuesService.create with dto and return result', async () => {
      const createDto: CreateVenueDto = {
        name: 'Test Venue',
        slug: 'test-venue',
        logoUrl: 'https://example.com/logo.png',
        location: 'Test Location',
      };

      mockVenuesService.create.mockResolvedValue(mockVenue);

      const result = await controller.create(createDto);

      expect(service.create).toHaveBeenCalledWith(createDto);
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockVenue);
    });

    it('should propagate errors from service', async () => {
      const createDto: CreateVenueDto = {
        name: 'Test Venue',
        slug: 'test-venue',
        logoUrl: 'https://example.com/logo.png',
        location: 'Test Location',
      };

      const error = new Error('Service error');
      mockVenuesService.create.mockRejectedValue(error);

      await expect(controller.create(createDto)).rejects.toThrow('Service error');
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should call venuesService.findAll with userId and role from request', async () => {
      const mockRequest = {
        user: {
          id: 'user-id-1',
          role: Role.PLATFORM_ADMIN,
        },
      };

      const mockVenues = [mockVenue];
      mockVenuesService.findAll.mockResolvedValue(mockVenues);

      const result = await controller.findAll(mockRequest);

      expect(service.findAll).toHaveBeenCalledWith('user-id-1', Role.PLATFORM_ADMIN);
      expect(service.findAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockVenues);
    });

    it('should handle venue admin role correctly', async () => {
      const mockRequest = {
        user: {
          id: 'venue-admin-id',
          role: Role.VENUE_ADMIN,
        },
      };

      const mockVenues = [mockVenue];
      mockVenuesService.findAll.mockResolvedValue(mockVenues);

      const result = await controller.findAll(mockRequest);

      expect(service.findAll).toHaveBeenCalledWith('venue-admin-id', Role.VENUE_ADMIN);
      expect(result).toEqual(mockVenues);
    });

    it('should propagate errors from service', async () => {
      const mockRequest = {
        user: {
          id: 'user-id-1',
          role: Role.PLATFORM_ADMIN,
        },
      };

      const error = new Error('Service error');
      mockVenuesService.findAll.mockRejectedValue(error);

      await expect(controller.findAll(mockRequest)).rejects.toThrow('Service error');
    });
  });

  describe('findOne', () => {
    it('should call venuesService.findOne with venueId param', async () => {
      const venueId = 'venue-id-1';
      mockVenuesService.findOne.mockResolvedValue(mockVenue);

      const result = await controller.findOne(venueId);

      expect(service.findOne).toHaveBeenCalledWith(venueId);
      expect(service.findOne).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockVenue);
    });

    it('should return venue data', async () => {
      const venueId = 'venue-id-1';
      mockVenuesService.findOne.mockResolvedValue(mockVenue);

      const result = await controller.findOne(venueId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('slug');
      expect(result.id).toBe(venueId);
    });

    it('should propagate errors from service', async () => {
      const venueId = 'non-existent-id';
      const error = new Error('Venue not found');
      mockVenuesService.findOne.mockRejectedValue(error);

      await expect(controller.findOne(venueId)).rejects.toThrow('Venue not found');
      expect(service.findOne).toHaveBeenCalledWith(venueId);
    });
  });

  describe('update', () => {
    it('should call venuesService.update with venueId and dto', async () => {
      const venueId = 'venue-id-1';
      const updateDto: UpdateVenueDto = {
        name: 'Updated Venue Name',
      };

      const updatedVenue = { ...mockVenue, name: 'Updated Venue Name' };
      mockVenuesService.update.mockResolvedValue(updatedVenue);

      const result = await controller.update(venueId, updateDto);

      expect(service.update).toHaveBeenCalledWith(venueId, updateDto);
      expect(service.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedVenue);
    });

    it('should return updated venue', async () => {
      const venueId = 'venue-id-1';
      const updateDto: UpdateVenueDto = {
        name: 'Updated Name',
        location: 'Updated Location',
      };

      const updatedVenue = {
        ...mockVenue,
        name: 'Updated Name',
        location: 'Updated Location',
      };
      mockVenuesService.update.mockResolvedValue(updatedVenue);

      const result = await controller.update(venueId, updateDto);

      expect(result.name).toBe('Updated Name');
      expect(result.location).toBe('Updated Location');
    });

    it('should handle partial updates', async () => {
      const venueId = 'venue-id-1';
      const updateDto: UpdateVenueDto = {
        logoUrl: 'https://example.com/new-logo.png',
      };

      const updatedVenue = {
        ...mockVenue,
        logoUrl: 'https://example.com/new-logo.png',
      };
      mockVenuesService.update.mockResolvedValue(updatedVenue);

      const result = await controller.update(venueId, updateDto);

      expect(service.update).toHaveBeenCalledWith(venueId, updateDto);
      expect(result.logoUrl).toBe('https://example.com/new-logo.png');
    });

    it('should propagate errors from service', async () => {
      const venueId = 'non-existent-id';
      const updateDto: UpdateVenueDto = {
        name: 'Updated Name',
      };

      const error = new Error('Venue not found');
      mockVenuesService.update.mockRejectedValue(error);

      await expect(controller.update(venueId, updateDto)).rejects.toThrow('Venue not found');
      expect(service.update).toHaveBeenCalledWith(venueId, updateDto);
    });
  });

  describe('deactivate', () => {
    it('should call venuesService.deactivate with venueId', async () => {
      const venueId = 'venue-id-1';
      const deactivatedVenue = { ...mockVenue, isActive: false };
      mockVenuesService.deactivate.mockResolvedValue(deactivatedVenue);

      const result = await controller.deactivate(venueId);

      expect(service.deactivate).toHaveBeenCalledWith(venueId);
      expect(service.deactivate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(deactivatedVenue);
    });

    it('should return deactivated venue', async () => {
      const venueId = 'venue-id-1';
      const deactivatedVenue = { ...mockVenue, isActive: false };
      mockVenuesService.deactivate.mockResolvedValue(deactivatedVenue);

      const result = await controller.deactivate(venueId);

      expect(result.isActive).toBe(false);
      expect(result.id).toBe(venueId);
    });

    it('should propagate errors from service', async () => {
      const venueId = 'non-existent-id';
      const error = new Error('Venue not found');
      mockVenuesService.deactivate.mockRejectedValue(error);

      await expect(controller.deactivate(venueId)).rejects.toThrow('Venue not found');
      expect(service.deactivate).toHaveBeenCalledWith(venueId);
    });
  });
});
