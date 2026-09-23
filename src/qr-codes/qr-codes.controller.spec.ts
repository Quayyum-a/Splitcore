import { Test, TestingModule } from '@nestjs/testing';
import { QrCodesController } from './qr-codes.controller';
import { QrCodesService } from './qr-codes.service';
import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { Role } from '@prisma/client';

describe('QrCodesController', () => {
  let controller: QrCodesController;
  let service: QrCodesService;

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

  const mockQrCodesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    deactivate: jest.fn(),
    regenerate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QrCodesController],
      providers: [
        {
          provide: QrCodesService,
          useValue: mockQrCodesService,
        },
      ],
    }).compile();

    controller = module.get<QrCodesController>(QrCodesController);
    service = module.get<QrCodesService>(QrCodesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a QR code', async () => {
      const createDto: CreateQrCodeDto = {
        venueId: 'venue-id-1',
        entertainerId: 'entertainer-id-1',
        location: 'Table 5',
      };

      mockQrCodesService.create.mockResolvedValue(mockQrCode);

      const result = await controller.create(createDto);

      expect(service.create).toHaveBeenCalledWith(createDto);
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockQrCode);
    });

    it('should propagate errors from service', async () => {
      const createDto: CreateQrCodeDto = {
        venueId: 'venue-id-1',
        location: 'Table 5',
      };

      const error = new Error('Venue not found');
      mockQrCodesService.create.mockRejectedValue(error);

      await expect(controller.create(createDto)).rejects.toThrow('Venue not found');
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should return all QR codes for PLATFORM_ADMIN', async () => {
      const mockRequest = {
        user: {
          id: 'admin-id',
          role: Role.PLATFORM_ADMIN,
        },
      };

      const qrCodes = [mockQrCode];
      mockQrCodesService.findAll.mockResolvedValue(qrCodes);

      const result = await controller.findAll(mockRequest);

      expect(service.findAll).toHaveBeenCalledWith('admin-id', Role.PLATFORM_ADMIN);
      expect(result).toEqual(qrCodes);
    });

    it('should return venue QR codes for VENUE_ADMIN', async () => {
      const mockRequest = {
        user: {
          id: 'venue-admin-id',
          role: Role.VENUE_ADMIN,
        },
      };

      const qrCodes = [mockQrCode];
      mockQrCodesService.findAll.mockResolvedValue(qrCodes);

      const result = await controller.findAll(mockRequest);

      expect(service.findAll).toHaveBeenCalledWith('venue-admin-id', Role.VENUE_ADMIN);
      expect(result).toEqual(qrCodes);
    });
  });

  describe('findOne', () => {
    it('should return QR code by ID', async () => {
      mockQrCodesService.findOne.mockResolvedValue(mockQrCode);

      const result = await controller.findOne('qr-code-id-1');

      expect(service.findOne).toHaveBeenCalledWith('qr-code-id-1');
      expect(result).toEqual(mockQrCode);
    });

    it('should propagate errors from service', async () => {
      const error = new Error('QR code not found');
      mockQrCodesService.findOne.mockRejectedValue(error);

      await expect(controller.findOne('invalid-id')).rejects.toThrow('QR code not found');
    });
  });

  describe('deactivate', () => {
    it('should deactivate QR code', async () => {
      const deactivatedQrCode = {
        ...mockQrCode,
        isActive: false,
        deactivatedAt: new Date(),
      };
      mockQrCodesService.deactivate.mockResolvedValue(deactivatedQrCode);

      const result = await controller.deactivate('qr-code-id-1');

      expect(service.deactivate).toHaveBeenCalledWith('qr-code-id-1');
      expect(result.isActive).toBe(false);
      expect(result.deactivatedAt).toBeDefined();
    });

    it('should propagate errors from service', async () => {
      const error = new Error('QR code not found');
      mockQrCodesService.deactivate.mockRejectedValue(error);

      await expect(controller.deactivate('invalid-id')).rejects.toThrow('QR code not found');
    });
  });

  describe('regenerate', () => {
    it('should regenerate QR code with new token', async () => {
      const newQrCode = {
        ...mockQrCode,
        id: 'new-qr-code-id',
        publicToken: 'new1234token5678abcd9012efgh3456',
      };
      mockQrCodesService.regenerate.mockResolvedValue(newQrCode);

      const result = await controller.regenerate('qr-code-id-1');

      expect(service.regenerate).toHaveBeenCalledWith('qr-code-id-1');
      expect(result).toEqual(newQrCode);
      expect(result.publicToken).not.toBe(mockQrCode.publicToken);
    });

    it('should propagate errors from service', async () => {
      const error = new Error('QR code not found');
      mockQrCodesService.regenerate.mockRejectedValue(error);

      await expect(controller.regenerate('invalid-id')).rejects.toThrow('QR code not found');
    });
  });
});
