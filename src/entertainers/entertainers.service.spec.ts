import { Test, TestingModule } from '@nestjs/testing';
import { EntertainersService } from './entertainers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, KycStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

describe('EntertainersService', () => {
  let service: EntertainersService;
  let prisma: PrismaService;

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
  };

  const mockPrismaService = {
    entertainer: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    venueEntertainer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    qrCode: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntertainersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<EntertainersService>(EntertainersService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an entertainer with valid data and set kycStatus to NOT_STARTED', async () => {
      const createDto = {
        stageName: 'DJ Neptune',
        legalName: 'Patrick Imohiosen',
        phone: '+2348012345678',
        bankName: 'GTBank',
        accountNumber: '0123456789',
      };

      mockPrismaService.entertainer.create.mockResolvedValue(mockEntertainer);

      const result = await service.create(createDto);

      expect(result.kycStatus).toBe(KycStatus.NOT_STARTED);
      expect(result.venueIds).toEqual([]);
      expect(mockPrismaService.entertainer.create).toHaveBeenCalledWith({
        data: createDto,
      });
    });

    it('should throw ConflictException when phone already exists', async () => {
      const createDto = {
        stageName: 'DJ Test',
        legalName: 'Test Name',
        phone: '+2348012345678',
      };

      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.entertainer.create.mockRejectedValue(duplicateError);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(createDto)).rejects.toThrow(
        'An entertainer with this phone number already exists',
      );
    });
  });

  describe('findAll', () => {
    it('should return all entertainers for PLATFORM_ADMIN', async () => {
      const mockEntertainersWithRel = [
        { ...mockEntertainer, venueEntertainers: [{ venueId: 'venue-id-1' }] },
        { ...mockEntertainer, id: 'entertainer-id-2', venueEntertainers: [] },
      ];
      mockPrismaService.entertainer.findMany.mockResolvedValue(mockEntertainersWithRel);

      const result = await service.findAll('admin-user-id', Role.PLATFORM_ADMIN);

      expect(result).toHaveLength(2);
      expect(result[0].venueIds).toEqual(['venue-id-1']);
      expect(result[1].venueIds).toEqual([]);
      expect(mockPrismaService.entertainer.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      });
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return only entertainers linked to venue for VENUE_ADMIN', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        venueId: 'venue-id-1',
      });

      const venueEntertainers = [
        {
          venueId: 'venue-id-1',
          entertainerId: 'entertainer-id-1',
          entertainer: {
            ...mockEntertainer,
            venueEntertainers: [{ venueId: 'venue-id-1' }],
          },
        },
      ];
      mockPrismaService.venueEntertainer.findMany.mockResolvedValue(venueEntertainers);

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockEntertainer.id);
      expect(result[0].venueIds).toEqual(['venue-id-1']);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'venue-admin-user-id' },
        select: { venueId: true },
      });
      expect(mockPrismaService.venueEntertainer.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-id-1' },
        include: {
          entertainer: {
            include: {
              venueEntertainers: {
                select: { venueId: true },
              },
            },
          },
        },
      });
    });

    it('should return empty array if VENUE_ADMIN has no venueId', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        venueId: null,
      });

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toEqual([]);
      expect(mockPrismaService.venueEntertainer.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return entertainer with venueIds array', async () => {
      const mockEntertainerWithVenues = {
        ...mockEntertainer,
        venueEntertainers: [{ venueId: 'venue-id-1' }, { venueId: 'venue-id-2' }],
      };

      mockPrismaService.entertainer.findUnique.mockResolvedValue(mockEntertainerWithVenues);

      const result = await service.findOne('entertainer-id-1');

      expect(result).toHaveProperty('venueIds');
      expect(result.venueIds).toEqual(['venue-id-1', 'venue-id-2']);
      expect(result).not.toHaveProperty('venueEntertainers');
      expect(mockPrismaService.entertainer.findUnique).toHaveBeenCalledWith({
        where: { id: 'entertainer-id-1' },
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      });
    });

    it('should throw NotFoundException with invalid ID', async () => {
      mockPrismaService.entertainer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        'Entertainer with ID invalid-id not found',
      );
    });
  });

  describe('update', () => {
    it('should update entertainer with partial fields', async () => {
      const updateDto = { stageName: 'DJ Updated' };
      const updatedEntertainer = {
        ...mockEntertainer,
        stageName: 'DJ Updated',
        venueEntertainers: [{ venueId: 'venue-id-1' }],
      };

      mockPrismaService.entertainer.update.mockResolvedValue(updatedEntertainer);

      const result = await service.update('entertainer-id-1', updateDto);

      expect(result.stageName).toBe('DJ Updated');
      expect(result.venueIds).toEqual(['venue-id-1']);
      expect(mockPrismaService.entertainer.update).toHaveBeenCalledWith({
        where: { id: 'entertainer-id-1' },
        data: updateDto,
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      });
    });

    it('should throw NotFoundException when updating non-existent entertainer', async () => {
      const updateDto = { stageName: 'DJ Updated' };

      const notFoundError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });

      mockPrismaService.entertainer.update.mockRejectedValue(notFoundError);

      await expect(service.update('invalid-id', updateDto)).rejects.toThrow(NotFoundException);
      await expect(service.update('invalid-id', updateDto)).rejects.toThrow(
        'Entertainer with ID invalid-id not found',
      );
    });

    it('should throw ConflictException when updating to duplicate phone', async () => {
      const updateDto = { phone: '+2348012345678' };

      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.entertainer.update.mockRejectedValue(duplicateError);

      await expect(service.update('entertainer-id-1', updateDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.update('entertainer-id-1', updateDto)).rejects.toThrow(
        'An entertainer with this phone number already exists',
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false AND deactivate related QR codes in transaction', async () => {
      const deactivatedEntertainer = {
        ...mockEntertainer,
        isActive: false,
        venueEntertainers: [{ venueId: 'venue-id-1' }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          entertainer: {
            update: jest.fn().mockResolvedValue(deactivatedEntertainer),
          },
          qrCode: {
            updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
        };
        return callback(txMock);
      });

      const result = await service.deactivate('entertainer-id-1');

      expect(result.isActive).toBe(false);
      expect(result.venueIds).toEqual(['venue-id-1']);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when deactivating non-existent entertainer', async () => {
      const notFoundError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });

      mockPrismaService.$transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          entertainer: {
            update: jest.fn().mockRejectedValue(notFoundError),
          },
          qrCode: {
            updateMany: jest.fn(),
          },
        };
        return callback(txMock);
      });

      await expect(service.deactivate('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.deactivate('invalid-id')).rejects.toThrow(
        'Entertainer with ID invalid-id not found',
      );
    });
  });

  describe('linkToVenue', () => {
    it('should create VenueEntertainer record', async () => {
      const mockLink = {
        id: 'link-id-1',
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        createdAt: new Date(),
      };

      mockPrismaService.venueEntertainer.create.mockResolvedValue(mockLink);

      const result = await service.linkToVenue('entertainer-id-1', 'venue-id-1');

      expect(result).toEqual(mockLink);
      expect(mockPrismaService.venueEntertainer.create).toHaveBeenCalledWith({
        data: {
          venueId: 'venue-id-1',
          entertainerId: 'entertainer-id-1',
        },
      });
    });

    it('should throw ConflictException when link already exists', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );

      mockPrismaService.venueEntertainer.create.mockRejectedValue(duplicateError);

      await expect(service.linkToVenue('entertainer-id-1', 'venue-id-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.linkToVenue('entertainer-id-1', 'venue-id-1')).rejects.toThrow(
        'Entertainer is already linked to this venue',
      );
    });
  });

  describe('unlinkFromVenue', () => {
    it('should delete VenueEntertainer record', async () => {
      const mockLink = {
        id: 'link-id-1',
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        createdAt: new Date(),
      };

      mockPrismaService.venueEntertainer.findFirst.mockResolvedValue(mockLink);
      mockPrismaService.venueEntertainer.delete.mockResolvedValue(mockLink);

      await service.unlinkFromVenue('entertainer-id-1', 'venue-id-1');

      expect(mockPrismaService.venueEntertainer.findFirst).toHaveBeenCalledWith({
        where: {
          venueId: 'venue-id-1',
          entertainerId: 'entertainer-id-1',
        },
      });
      expect(mockPrismaService.venueEntertainer.delete).toHaveBeenCalledWith({
        where: { id: 'link-id-1' },
      });
    });

    it('should throw NotFoundException when link does not exist', async () => {
      mockPrismaService.venueEntertainer.findFirst.mockResolvedValue(null);

      await expect(service.unlinkFromVenue('entertainer-id-1', 'venue-id-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.unlinkFromVenue('entertainer-id-1', 'venue-id-1')).rejects.toThrow(
        'Entertainer is not linked to this venue',
      );
      expect(mockPrismaService.venueEntertainer.delete).not.toHaveBeenCalled();
    });
  });
});
