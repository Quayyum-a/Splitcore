import { Test, TestingModule } from '@nestjs/testing';
import { GuestService } from './guest.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, GoneException } from '@nestjs/common';

describe('GuestService', () => {
  let service: GuestService;
  let prisma: PrismaService;

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
    venue: {
      id: 'venue-id-1',
      name: 'Test Venue',
      slug: 'test-venue',
      logoUrl: 'https://example.com/logo.png',
      location: 'Test Location',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    entertainer: {
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
    },
  };

  const mockPrismaService = {
    qrCode: {
      findUnique: jest.fn(),
    },
    guestSession: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<GuestService>(GuestService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveQrCode', () => {
    it('should resolve QR code and create guest session with 24-hour expiry', async () => {
      const mockSession = {
        id: 'session-id-1',
        qrCodeId: 'qr-code-id-1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(mockQrCode);
      mockPrismaService.guestSession.create.mockResolvedValue(mockSession);

      const result = await service.resolveQrCode('abcd1234efgh5678ijkl9012mnop3456');

      expect(result).toMatchObject({
        venue: {
          id: mockQrCode.venue.id,
          name: mockQrCode.venue.name,
          logoUrl: mockQrCode.venue.logoUrl,
          location: mockQrCode.venue.location,
        },
        entertainer: {
          id: mockQrCode.entertainer.id,
          stageName: mockQrCode.entertainer.stageName,
        },
        location: mockQrCode.location,
        sessionId: mockSession.id,
        expiresAt: mockSession.expiresAt,
      });

      expect(mockPrismaService.guestSession.create).toHaveBeenCalledWith({
        data: {
          qrCodeId: mockQrCode.id,
          expiresAt: expect.any(Date),
        },
      });

      // Verify expiresAt is 24 hours from now
      const callArgs = mockPrismaService.guestSession.create.mock.calls[0][0];
      const expiryTime = callArgs.data.expiresAt.getTime();
      const now = Date.now();
      const expectedExpiry = now + 24 * 60 * 60 * 1000;
      expect(expiryTime).toBeGreaterThan(now);
      expect(expiryTime).toBeLessThanOrEqual(expectedExpiry + 1000); // 1 second tolerance
    });

    it('should handle QR code without entertainer', async () => {
      const qrCodeWithoutEntertainer = {
        ...mockQrCode,
        entertainerId: null,
        entertainer: null,
      };

      const mockSession = {
        id: 'session-id-2',
        qrCodeId: 'qr-code-id-1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(qrCodeWithoutEntertainer);
      mockPrismaService.guestSession.create.mockResolvedValue(mockSession);

      const result = await service.resolveQrCode('test-token');

      expect(result.entertainer).toBeNull();
      expect(result.venue).toBeDefined();
    });

    it('should throw NotFoundException (404) when token does not exist', async () => {
      mockPrismaService.qrCode.findUnique.mockResolvedValue(null);

      await expect(service.resolveQrCode('non-existent-token')).rejects.toThrow(NotFoundException);
      await expect(service.resolveQrCode('non-existent-token')).rejects.toThrow(
        'QR code not found',
      );
    });

    it('should throw GoneException (410) when QR code is deactivated', async () => {
      const deactivatedQrCode = {
        ...mockQrCode,
        isActive: false,
        deactivatedAt: new Date(),
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(deactivatedQrCode);

      await expect(service.resolveQrCode('deactivated-token')).rejects.toThrow(GoneException);
      await expect(service.resolveQrCode('deactivated-token')).rejects.toThrow(
        'QR code has been deactivated',
      );
    });

    it('should throw GoneException (410) when venue is deactivated', async () => {
      const qrCodeWithDeactivatedVenue = {
        ...mockQrCode,
        venue: {
          ...mockQrCode.venue,
          isActive: false,
        },
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(qrCodeWithDeactivatedVenue);

      await expect(service.resolveQrCode('test-token')).rejects.toThrow(GoneException);
      await expect(service.resolveQrCode('test-token')).rejects.toThrow(
        'Venue is no longer active',
      );
    });

    it('should throw GoneException (410) when entertainer is deactivated', async () => {
      const qrCodeWithDeactivatedEntertainer = {
        ...mockQrCode,
        entertainer: {
          ...mockQrCode.entertainer,
          isActive: false,
        },
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(qrCodeWithDeactivatedEntertainer);

      await expect(service.resolveQrCode('test-token')).rejects.toThrow(GoneException);
      await expect(service.resolveQrCode('test-token')).rejects.toThrow(
        'Entertainer is no longer active',
      );
    });

    it('should not check entertainer status if QR has no entertainer', async () => {
      const qrCodeWithoutEntertainer = {
        ...mockQrCode,
        entertainerId: null,
        entertainer: null,
      };

      const mockSession = {
        id: 'session-id-3',
        qrCodeId: 'qr-code-id-1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaService.qrCode.findUnique.mockResolvedValue(qrCodeWithoutEntertainer);
      mockPrismaService.guestSession.create.mockResolvedValue(mockSession);

      const result = await service.resolveQrCode('test-token');

      expect(result).toBeDefined();
      expect(result.entertainer).toBeNull();
    });
  });
});
