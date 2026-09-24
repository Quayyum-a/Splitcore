import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Guest (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let venue: any;
  let entertainer: any;
  let activeQrCode: any;
  let deactivatedQrCode: any;
  let deactivatedVenueQrCode: any;
  let deactivatedEntertainerQrCode: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    await cleanDatabase();
    await setupTestData();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  async function cleanDatabase() {
    await prisma.guestSession.deleteMany();
    await prisma.qrCode.deleteMany();
    await prisma.venueEntertainer.deleteMany();
    await prisma.entertainer.deleteMany();
    await prisma.user.deleteMany();
    await prisma.venue.deleteMany();
  }

  async function setupTestData() {
    // Create active venue
    venue = await prisma.venue.create({
      data: {
        name: 'Test Venue',
        slug: 'test-venue',
        location: 'Test Location',
        logoUrl: 'https://example.com/logo.png',
      },
    });

    // Create deactivated venue
    const deactivatedVenue = await prisma.venue.create({
      data: {
        name: 'Deactivated Venue',
        slug: 'deactivated-venue',
        location: 'Old Location',
        isActive: false,
      },
    });

    // Create active entertainer
    entertainer = await prisma.entertainer.create({
      data: {
        stageName: 'Test DJ',
        legalName: 'Test Artist',
        phone: '+2348011111111',
      },
    });

    // Create deactivated entertainer
    const deactivatedEntertainer = await prisma.entertainer.create({
      data: {
        stageName: 'Old DJ',
        legalName: 'Old Artist',
        phone: '+2348022222222',
        isActive: false,
      },
    });

    // Link entertainers to venue
    await prisma.venueEntertainer.create({
      data: {
        venueId: venue.id,
        entertainerId: entertainer.id,
      },
    });

    await prisma.venueEntertainer.create({
      data: {
        venueId: venue.id,
        entertainerId: deactivatedEntertainer.id,
      },
    });

    // Create active QR code
    activeQrCode = await prisma.qrCode.create({
      data: {
        publicToken: 'active1234567890abcdef1234567890ab',
        venueId: venue.id,
        entertainerId: entertainer.id,
        location: 'Table 1',
      },
    });

    // Create deactivated QR code
    deactivatedQrCode = await prisma.qrCode.create({
      data: {
        publicToken: 'deactivated1234567890abcdef12345678',
        venueId: venue.id,
        location: 'Table 2',
        isActive: false,
        deactivatedAt: new Date(),
      },
    });

    // Create QR code with deactivated venue
    deactivatedVenueQrCode = await prisma.qrCode.create({
      data: {
        publicToken: 'venuegone1234567890abcdef1234567890',
        venueId: deactivatedVenue.id,
        location: 'Table 3',
      },
    });

    // Create QR code with deactivated entertainer
    deactivatedEntertainerQrCode = await prisma.qrCode.create({
      data: {
        publicToken: 'djgone1234567890abcdef12345678901234',
        venueId: venue.id,
        entertainerId: deactivatedEntertainer.id,
        location: 'Table 4',
      },
    });
  }

  describe('GET /t/:publicToken', () => {
    it('should return 200 with session for valid active QR code', async () => {
      const response = await request(app.getHttpServer())
        .get(`/t/${activeQrCode.publicToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        venue: {
          id: venue.id,
          name: venue.name,
          logoUrl: venue.logoUrl,
          location: venue.location,
        },
        entertainer: {
          id: entertainer.id,
          stageName: entertainer.stageName,
        },
        location: activeQrCode.location,
      });

      expect(response.body.sessionId).toBeDefined();
      expect(response.body.expiresAt).toBeDefined();

      // Verify session was created in database
      const session = await prisma.guestSession.findUnique({
        where: { id: response.body.sessionId },
      });
      expect(session).not.toBeNull();
      expect(session?.qrCodeId).toBe(activeQrCode.id);

      // Verify expiresAt is 24 hours from now
      const expiryTime = new Date(response.body.expiresAt).getTime();
      const now = Date.now();
      const expectedExpiry = now + 24 * 60 * 60 * 1000;
      expect(expiryTime).toBeGreaterThan(now);
      expect(expiryTime).toBeLessThanOrEqual(expectedExpiry + 5000); // 5 second tolerance
    });

    it('should return 200 with null entertainer for venue-only QR code', async () => {
      const venueOnlyQr = await prisma.qrCode.create({
        data: {
          publicToken: 'venueonly1234567890abcdef1234567890',
          venueId: venue.id,
          entertainerId: null,
          location: 'General Area',
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/t/${venueOnlyQr.publicToken}`)
        .expect(200);

      expect(response.body.entertainer).toBeNull();
      expect(response.body.venue).toBeDefined();
    });

    it('should return 404 for non-existent token', async () => {
      const response = await request(app.getHttpServer())
        .get('/t/nonexistent1234567890abcdef1234567')
        .expect(404);

      expect(response.body.message).toContain('not found');
    });

    it('should return 410 for deactivated QR code', async () => {
      const response = await request(app.getHttpServer())
        .get(`/t/${deactivatedQrCode.publicToken}`)
        .expect(410);

      expect(response.body.message).toContain('deactivated');
    });

    it('should return 410 for QR code with deactivated venue', async () => {
      const response = await request(app.getHttpServer())
        .get(`/t/${deactivatedVenueQrCode.publicToken}`)
        .expect(410);

      expect(response.body.message).toContain('Venue is no longer active');
    });

    it('should return 410 for QR code with deactivated entertainer', async () => {
      const response = await request(app.getHttpServer())
        .get(`/t/${deactivatedEntertainerQrCode.publicToken}`)
        .expect(410);

      expect(response.body.message).toContain('Entertainer is no longer active');
    });

    it('should be accessible without authentication', async () => {
      // No Authorization header - this is the critical test for @Public()
      const response = await request(app.getHttpServer())
        .get(`/t/${activeQrCode.publicToken}`)
        .expect(200);

      expect(response.body.sessionId).toBeDefined();
    });
  });
});
