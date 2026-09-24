import { Test, TestingModule } from '@nestjs/testing';
import { QrCodesService } from './qr-codes.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('QrCodesService', () => {
  let service: QrCodesService;
  let prisma: PrismaService;

  const mockVenue = {
    id: 'venue-id-1',
    name: 'Test Venue',
    slug: 'test-venue',
    location: 'Test Location',
    logoUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEntertainer = {
    id: 'entertainer-id-1',
    stageName: 'Test DJ',
    legalName: 'Test',
    phone: '+2348012345678',
    bankName: null,
    accountNumber: null,
    kycStatus: 'NOT_STARTED',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQrCode = {
    id: 'qr-code-id-1',
    publicToken: 'abcd1234efgh5678ijkl9012mnop3456',
    venueId: 'venue-id-1',
    entertainerId: 'entertainer-id-1',
    location: 'Table 5',
    isActive: true,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    venue: {
      findUnique: jest.fn(),
    },
    entertainer: {
      findUnique: jest.fn(),
    },
    venueEntertainer: {
      findFirst: jest.fn(),
    },
    qrCode: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrCodesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<QrCodesService>(QrCodesService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePublicToken', () => {
    it('should return 32-character hex string', () => {
      const token = service.generatePublicToken();
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(service.generatePublicToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('create', () => {
    it('should create QR code without entertainer', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        location: 'Table 5',
      };

      mockPrismaService.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrismaService.qrCode.create.mockResolvedValue(mockQrCode);

      const result = await service.create(createDto);

      expect(result).toEqual(mockQrCode);
      expect(mockPrismaService.venue.findUnique).toHaveBeenCalledWith({
        where: { id: createDto.venueId },
      });
      expect(mockPrismaService.qrCode.create).toHaveBeenCalled();
    });

    it('should create QR code with linked entertainer', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        location: 'Table 5',
      };

      mockPrismaService.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrismaService.entertainer.findUnique.mockResolvedValue(mockEntertainer);
      mockPrismaService.venueEntertainer.findFirst.mockResolvedValue({ id: 'link-id' });
      mockPrismaService.qrCode.create.mockResolvedValue(mockQrCode);

      const result = await service.create(createDto);

      expect(result).toEqual(mockQrCode);
      expect(mockPrismaService.venueEntertainer.findFirst).toHaveBeenCalledWith({
        where: {
          venueId: createDto.venueId,
          entertainerId: createDto.entertainerId,
        },
      });
    });

    it('should throw NotFoundException when venue does not exist', async () => {
      const createDto = {
        venueId: 'non-existent-venue',
        location: 'Table 5',
      };

      mockPrismaService.venue.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Venue with ID non-existent-venue not found',
      );
    });

    it('should throw NotFoundException when entertainer does not exist', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerId: 'non-existent-entertainer',
        location: 'Table 5',
      };

      mockPrismaService.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrismaService.entertainer.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Entertainer with ID non-existent-entertainer not found',
      );
    });

    it('should throw BadRequestException when entertainer not linked to venue', async () => {
      const createDto = {
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        location: 'Table 5',
      };

      mockPrismaService.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrismaService.entertainer.findUnique.mockResolvedValue(mockEntertainer);
      mockPrismaService.venueEntertainer.findFirst.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Entertainer is not linked to this venue',
      );
    });
  });

  describe('findAll', () => {
    it('should return all QR codes for PLATFORM_ADMIN', async () => {
      const qrCodes = [{ ...mockQrCode, venue: mockVenue, entertainer: mockEntertainer }];
      mockPrismaService.qrCode.findMany.mockResolvedValue(qrCodes);

      const result = await service.findAll('admin-user-id', Role.PLATFORM_ADMIN);

      expect(result).toEqual(qrCodes);
      expect(mockPrismaService.qrCode.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        include: {
          venue: true,
          entertainer: true,
        },
      });
    });

    it('should return only venue QR codes for VENUE_ADMIN', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ venueId: 'venue-id-1' });
      const qrCodes = [{ ...mockQrCode, venue: mockVenue, entertainer: mockEntertainer }];
      mockPrismaService.qrCode.findMany.mockResolvedValue(qrCodes);

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toEqual(qrCodes);
      expect(mockPrismaService.qrCode.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-id-1' },
        orderBy: { createdAt: 'desc' },
        include: {
          venue: true,
          entertainer: true,
        },
      });
    });

    it('should return empty array if VENUE_ADMIN has no venueId', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ venueId: null });

      const result = await service.findAll('venue-admin-user-id', Role.VENUE_ADMIN);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return QR code with venue and entertainer details', async () => {
      const qrCodeWithDetails = {
        ...mockQrCode,
        venue: mockVenue,
        entertainer: mockEntertainer,
      };
      mockPrismaService.qrCode.findUnique.mockResolvedValue(qrCodeWithDetails);

      const result = await service.findOne('qr-code-id-1');

      expect(result).toEqual(qrCodeWithDetails);
      expect(mockPrismaService.qrCode.findUnique).toHaveBeenCalledWith({
        where: { id: 'qr-code-id-1' },
        include: {
          venue: true,
          entertainer: true,
        },
      });
    });

    it('should throw NotFoundException with invalid ID', async () => {
      mockPrismaService.qrCode.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        'QR code with ID invalid-id not found',
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false and set deactivatedAt timestamp', async () => {
      const deactivatedQrCode = {
        ...mockQrCode,
        isActive: false,
        deactivatedAt: new Date(),
      };
      mockPrismaService.qrCode.update.mockResolvedValue(deactivatedQrCode);

      const result = await service.deactivate('qr-code-id-1');

      expect(result.isActive).toBe(false);
      expect(result.deactivatedAt).toBeDefined();
      expect(mockPrismaService.qrCode.update).toHaveBeenCalledWith({
        where: { id: 'qr-code-id-1' },
        data: {
          isActive: false,
          deactivatedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException when deactivating non-existent QR code', async () => {
      mockPrismaService.qrCode.update.mockRejectedValue(new Error('Not found'));

      await expect(service.deactivate('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('regenerate', () => {
    it('should deactivate old code and create new code in transaction', async () => {
      const oldQrCode = mockQrCode;
      const newQrCode = {
        ...mockQrCode,
        id: 'new-qr-code-id',
        publicToken: 'new1234token5678abcd9012efgh3456',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          qrCode: {
            findUnique: jest.fn().mockResolvedValue(oldQrCode),
            update: jest.fn().mockResolvedValue({ ...oldQrCode, isActive: false }),
            create: jest.fn().mockResolvedValue(newQrCode),
          },
        };
        return callback(tx);
      });

      const result = await service.regenerate('qr-code-id-1');

      expect(result).toEqual(newQrCode);
      expect(result.id).not.toBe(oldQrCode.id);
      expect(result.publicToken).not.toBe(oldQrCode.publicToken);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when regenerating non-existent QR code', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          qrCode: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(service.regenerate('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.regenerate('invalid-id')).rejects.toThrow(
        'QR code with ID invalid-id not found',
      );
    });
  });
});
