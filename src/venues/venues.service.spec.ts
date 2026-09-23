import { Test, TestingModule } from '@nestjs/testing';
import { VenuesService } from './venues.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

describe('VenuesService', () => {
  let service: VenuesService;
  let prisma: PrismaService;

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

  const mockPrismaService = {
    venue: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VenuesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<VenuesService>(VenuesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clear all mock calls between tests
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a venue with valid data', async () => {
      const createDto = {
        name: 'Test Venue',
        slug: 'test-venue',
        logoUrl: 'https://example.com/logo.png',
        location: 'Test Location',
      };

      mockPrismaService.venue.create.mockResolvedValue(mockVenue);

      const result = await service.create(createDto);

      expect(result).toEqual(mockVenue);
      expect(mockPrismaService.venue.create).toHaveBeenCalledWith({
        data: createDto,
      });
    });

    it('should throw ConflictException when slug already exists', async () => {
      const createDto = {
        name: 'Test Venue',
        slug: 'duplicate-slug',
        location: 'Test Location',
      };

      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.venue.create.mockRejectedValue(duplicateError);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(createDto)).rejects.toThrow(
        'A venue with this slug already exists',
      );
    });
  });

  describe('findAll', () => {
    it('should return all venues for PLATFORM_ADMIN', async () => {
      const venues = [mockVenue, { ...mockVenue, id: 'venue-id-2', slug: 'venue-2' }];
      mockPrismaService.venue.findMany.mockResolvedValue(venues);

      const result = await service.findAll('admin-user-id', Role.PLATFORM_ADMIN);

      expect(result).toEqual(venues);
      expect(mockPrismaService.venue.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return only assigned venue for VENUE_ADMIN', async () => {
      const venueAdminVenue = mockVenue;
      mockPrismaService.user.findUnique.mockResolvedValue({
        venueId: 'venue-id-1',
      });
      mockPrismaService.venue.findMany.mockResolvedValue([venueAdminVenue]);

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toEqual([venueAdminVenue]);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'venue-admin-user-id' },
        select: { venueId: true },
      });
      expect(mockPrismaService.venue.findMany).toHaveBeenCalledWith({
        where: { id: 'venue-id-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array if VENUE_ADMIN has no venueId', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        venueId: null,
      });

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toEqual([]);
      expect(mockPrismaService.venue.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return venue with valid ID', async () => {
      mockPrismaService.venue.findUnique.mockResolvedValue(mockVenue);

      const result = await service.findOne('venue-id-1');

      expect(result).toEqual(mockVenue);
      expect(mockPrismaService.venue.findUnique).toHaveBeenCalledWith({
        where: { id: 'venue-id-1' },
      });
    });

    it('should throw NotFoundException with invalid ID', async () => {
      mockPrismaService.venue.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        'Venue with ID invalid-id not found',
      );
    });
  });

  describe('update', () => {
    it('should update venue and preserve unmodified fields', async () => {
      const updateDto = { name: 'Updated Name' };
      const updatedVenue = { ...mockVenue, name: 'Updated Name' };
      
      mockPrismaService.venue.update.mockResolvedValue(updatedVenue);

      const result = await service.update('venue-id-1', updateDto);

      expect(result).toEqual(updatedVenue);
      expect(mockPrismaService.venue.update).toHaveBeenCalledWith({
        where: { id: 'venue-id-1' },
        data: updateDto,
      });
    });

    it('should throw NotFoundException when updating non-existent venue', async () => {
      const updateDto = { name: 'Updated Name' };
      
      const notFoundError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.venue.update.mockRejectedValue(notFoundError);

      await expect(service.update('invalid-id', updateDto)).rejects.toThrow(NotFoundException);
      await expect(service.update('invalid-id', updateDto)).rejects.toThrow(
        'Venue with ID invalid-id not found',
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      const deactivatedVenue = { ...mockVenue, isActive: false };
      mockPrismaService.venue.update.mockResolvedValue(deactivatedVenue);

      const result = await service.deactivate('venue-id-1');

      expect(result).toEqual(deactivatedVenue);
      expect(result.isActive).toBe(false);
      expect(mockPrismaService.venue.update).toHaveBeenCalledWith({
        where: { id: 'venue-id-1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException when deactivating non-existent venue', async () => {
      const notFoundError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.venue.update.mockRejectedValue(notFoundError);

      await expect(service.deactivate('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.deactivate('invalid-id')).rejects.toThrow(
        'Venue with ID invalid-id not found',
      );
    });
  });
});
