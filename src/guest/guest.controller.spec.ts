import { Test, TestingModule } from '@nestjs/testing';
import { GuestController } from './guest.controller';
import { GuestService } from './guest.service';

describe('GuestController', () => {
  let controller: GuestController;
  let service: GuestService;

  const mockResponse = {
    venue: {
      id: 'venue-id-1',
      name: 'Test Venue',
      logoUrl: 'https://example.com/logo.png',
      location: 'Test Location',
    },
    entertainer: {
      id: 'entertainer-id-1',
      stageName: 'Test DJ',
    },
    location: 'Table 5',
    sessionId: 'session-id-1',
    expiresAt: new Date(),
  };

  const mockGuestService = {
    resolveQrCode: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GuestController],
      providers: [
        {
          provide: GuestService,
          useValue: mockGuestService,
        },
      ],
    }).compile();

    controller = module.get<GuestController>(GuestController);
    service = module.get<GuestService>(GuestService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('resolveQrCode', () => {
    it('should call service and return resolution response', async () => {
      mockGuestService.resolveQrCode.mockResolvedValue(mockResponse);

      const result = await controller.resolveQrCode('test-token-abcd1234');

      expect(service.resolveQrCode).toHaveBeenCalledWith('test-token-abcd1234');
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from service', async () => {
      const error = new Error('QR code not found');
      mockGuestService.resolveQrCode.mockRejectedValue(error);

      await expect(controller.resolveQrCode('invalid-token')).rejects.toThrow('QR code not found');
    });
  });
});
