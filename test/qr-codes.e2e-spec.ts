import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

describe('QR Codes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let platformAdmin: any;
  let platformAdminToken: string;
  let venueAdmin1: any;
  let venueAdmin1Token: string;
  let venueAdmin2: any;
  let venueAdmin2Token: string;

  let venue1: any;
  let venue2: any;
  let entertainer1: any;
  let entertainer2: any;

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
    jwtService = app.get<JwtService>(JwtService);

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
    const passwordHash = await bcrypt.hash('Password123!', 10);

    venue1 = await prisma.venue.create({
      data: {
        name: 'Venue One',
        slug: 'venue-one',
        location: 'Location One',
      },
    });

    venue2 = await prisma.venue.create({
      data: {
        name: 'Venue Two',
        slug: 'venue-two',
        location: 'Location Two',
      },
    });

    entertainer1 = await prisma.entertainer.create({
      data: {
        stageName: 'DJ Test 1',
        legalName: 'Test One',
        phone: '+2348011111111',
      },
    });

    entertainer2 = await prisma.entertainer.create({
      data: {
        stageName: 'DJ Test 2',
        legalName: 'Test Two',
        phone: '+2348022222222',
      },
    });

    // Link entertainer1 to venue1
    await prisma.venueEntertainer.create({
      data: {
        venueId: venue1.id,
        entertainerId: entertainer1.id,
      },
    });

    platformAdmin = await prisma.user.create({
      data: {
        email: 'platform@example.com',
        passwordHash,
        role: Role.PLATFORM_ADMIN,
      },
    });

    platformAdminToken = jwtService.sign({
      sub: platformAdmin.id,
      email: platformAdmin.email,
      role: platformAdmin.role,
    });

    venueAdmin1 = await prisma.user.create({
      data: {
        email: 'venue1admin@example.com',
        passwordHash,
        role: Role.VENUE_ADMIN,
        venueId: venue1.id,
      },
    });

    venueAdmin1Token = jwtService.sign({
      sub: venueAdmin1.id,
      email: venueAdmin1.email,
      role: venueAdmin1.role,
      venueId: venueAdmin1.venueId,
    });

    venueAdmin2 = await prisma.user.create({
      data: {
        email: 'venue2admin@example.com',
        passwordHash,
        role: Role.VENUE_ADMIN,
        venueId: venue2.id,
      },
    });

    venueAdmin2Token = jwtService.sign({
      sub: venueAdmin2.id,
      email: venueAdmin2.email,
      role: venueAdmin2.role,
      venueId: venueAdmin2.venueId,
    });
  }

  describe('POST /qr-codes', () => {
    it('should create QR code for venue without entertainer', async () => {
      const createDto = {
        venueId: venue1.id,
        location: 'Table 1',
      };

      const response = await request(app.getHttpServer())
        .post('/qr-codes')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toMatchObject({
        venueId: venue1.id,
        entertainerId: null,
        location: 'Table 1',
        isActive: true,
      });
      expect(response.body.publicToken).toHaveLength(32);
      expect(response.body.publicToken).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should create QR code with linked entertainer', async () => {
      const createDto = {
        venueId: venue1.id,
        entertainerId: entertainer1.id,
        location: 'Table 2',
      };

      const response = await request(app.getHttpServer())
        .post('/qr-codes')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toMatchObject({
        venueId: venue1.id,
        entertainerId: entertainer1.id,
        location: 'Table 2',
      });
    });

    it('should return 400 when entertainer is not linked to venue', async () => {
      const createDto = {
        venueId: venue1.id,
        entertainerId: entertainer2.id, // entertainer2 not linked to venue1
        location: 'Table 3',
      };

      const response = await request(app.getHttpServer())
        .post('/qr-codes')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(400);

      expect(response.body.message).toContain('not linked');
    });

    it('should return 403 when VENUE_ADMIN tries to create for another venue', async () => {
      const createDto = {
        venueId: venue2.id, // venue2, but using venue1 admin token
        location: 'Table 4',
      };

      await request(app.getHttpServer())
        .post('/qr-codes')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send(createDto)
        .expect(403);
    });

    it('should allow VENUE_ADMIN to create for their own venue', async () => {
      const createDto = {
        venueId: venue1.id,
        location: 'Table 5',
      };

      const response = await request(app.getHttpServer())
        .post('/qr-codes')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send(createDto)
        .expect(201);

      expect(response.body.venueId).toBe(venue1.id);
    });
  });

  describe('GET /qr-codes', () => {
    it('should return all QR codes for PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/qr-codes')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should return only venue QR codes for VENUE_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/qr-codes')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((qr: any) => {
        expect(qr.venueId).toBe(venue1.id);
      });
    });
  });

  describe('GET /qr-codes/:qrCodeId', () => {
    let qrCodeId: string;

    beforeAll(async () => {
      const qrCode = await prisma.qrCode.create({
        data: {
          publicToken: 'test1234token5678abcd9012efgh3456',
          venueId: venue1.id,
          location: 'Test Table',
        },
      });
      qrCodeId = qrCode.id;
    });

    it('should return QR code details', async () => {
      const response = await request(app.getHttpServer())
        .get(`/qr-codes/${qrCodeId}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body.id).toBe(qrCodeId);
      expect(response.body.venue).toBeDefined();
    });

    it('should return 404 for non-existent QR code', async () => {
      await request(app.getHttpServer())
        .get('/qr-codes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });

  describe('DELETE /qr-codes/:qrCodeId', () => {
    it('should deactivate QR code and set deactivatedAt timestamp', async () => {
      const qrCode = await prisma.qrCode.create({
        data: {
          publicToken: 'deactivate1234567890abcdef12345678',
          venueId: venue1.id,
          location: 'To Deactivate',
        },
      });

      const response = await request(app.getHttpServer())
        .delete(`/qr-codes/${qrCode.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body.isActive).toBe(false);
      expect(response.body.deactivatedAt).toBeDefined();
      expect(new Date(response.body.deactivatedAt).getTime()).toBeGreaterThan(0);

      // Verify in database
      const deactivatedQr = await prisma.qrCode.findUnique({
        where: { id: qrCode.id },
      });
      expect(deactivatedQr?.isActive).toBe(false);
      expect(deactivatedQr?.deactivatedAt).not.toBeNull();
    });

    it('should return 404 for non-existent QR code', async () => {
      await request(app.getHttpServer())
        .delete('/qr-codes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });

  describe('POST /qr-codes/:qrCodeId/regenerate', () => {
    it('should create new QR code and deactivate old one', async () => {
      const oldQrCode = await prisma.qrCode.create({
        data: {
          publicToken: 'old1234token5678abcd9012efgh345678',
          venueId: venue1.id,
          entertainerId: entertainer1.id,
          location: 'Table 10',
        },
      });

      const oldToken = oldQrCode.publicToken;
      const oldId = oldQrCode.id;

      const response = await request(app.getHttpServer())
        .post(`/qr-codes/${oldId}/regenerate`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(201);

      // New QR code should have different ID and token
      expect(response.body.id).not.toBe(oldId);
      expect(response.body.publicToken).not.toBe(oldToken);
      expect(response.body.publicToken).toHaveLength(32);

      // But same venue, entertainer, location
      expect(response.body.venueId).toBe(venue1.id);
      expect(response.body.entertainerId).toBe(entertainer1.id);
      expect(response.body.location).toBe('Table 10');
      expect(response.body.isActive).toBe(true);

      // Old QR code should be deactivated
      const deactivatedOldQr = await prisma.qrCode.findUnique({
        where: { id: oldId },
      });
      expect(deactivatedOldQr?.isActive).toBe(false);
      expect(deactivatedOldQr?.deactivatedAt).not.toBeNull();
    });

    it('should return 404 for non-existent QR code', async () => {
      await request(app.getHttpServer())
        .post('/qr-codes/00000000-0000-0000-0000-000000000000/regenerate')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });
});
