import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/reset-database';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

describe('Entertainers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // Test users
  let platformAdmin: any;
  let platformAdminToken: string;
  let venueAdmin1: any;
  let venueAdmin1Token: string;
  let venueAdmin2: any;
  let venueAdmin2Token: string;

  // Test venues
  let venue1: any;
  let venue2: any;

  // Test entertainers
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

    await resetDatabase(prisma);
    await setupTestData();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

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

  describe('POST /entertainers', () => {
    it('should create an entertainer as PLATFORM_ADMIN', async () => {
      const createDto = {
        stageName: 'New DJ',
        legalName: 'New Artist',
        phone: '+2348033333333',
        bankName: 'GTBank',
        accountNumber: '0123456789',
      };

      const response = await request(app.getHttpServer())
        .post('/entertainers')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toMatchObject({
        stageName: createDto.stageName,
        legalName: createDto.legalName,
        phone: createDto.phone,
        bankName: createDto.bankName,
        accountNumber: createDto.accountNumber,
        kycStatus: 'NOT_STARTED',
        isActive: true,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.venueIds).toEqual([]);
    });

    it('should return 401 for unauthenticated request', async () => {
      const createDto = {
        stageName: 'Test DJ',
        legalName: 'Test',
        phone: '+2348044444444',
      };

      await request(app.getHttpServer()).post('/entertainers').send(createDto).expect(401);
    });

    it('should return 400 for invalid phone format', async () => {
      const createDto = {
        stageName: 'Test DJ',
        legalName: 'Test',
        phone: 'invalid-phone',
      };

      const response = await request(app.getHttpServer())
        .post('/entertainers')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(400);

      expect(Array.isArray(response.body.message)).toBe(true);
      expect(response.body.message.some((msg: string) => msg.includes('E.164'))).toBe(true);
    });

    it('should return 400 for invalid accountNumber format', async () => {
      const createDto = {
        stageName: 'Test DJ',
        legalName: 'Test',
        phone: '+2348055555555',
        accountNumber: 'abc123',
      };

      const response = await request(app.getHttpServer())
        .post('/entertainers')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(400);

      expect(Array.isArray(response.body.message)).toBe(true);
      expect(response.body.message.some((msg: string) => msg.includes('digits'))).toBe(true);
    });

    it('should return 409 for duplicate phone', async () => {
      const createDto = {
        stageName: 'Duplicate DJ',
        legalName: 'Duplicate',
        phone: entertainer1.phone,
      };

      const response = await request(app.getHttpServer())
        .post('/entertainers')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });
  });

  describe('GET /entertainers', () => {
    it('should return all entertainers for PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/entertainers')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);

      const entertainerIds = response.body.map((e: any) => e.id);
      expect(entertainerIds).toContain(entertainer1.id);
      expect(entertainerIds).toContain(entertainer2.id);
    });

    it('should return only entertainers linked to venue for VENUE_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/entertainers')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe(entertainer1.id);
      expect(response.body[0].venueIds).toContain(venue1.id);
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/entertainers').expect(401);
    });
  });

  describe('GET /entertainers/:entertainerId', () => {
    it('should return entertainer details for PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get(`/entertainers/${entertainer1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: entertainer1.id,
        stageName: entertainer1.stageName,
        legalName: entertainer1.legalName,
      });
      expect(response.body.venueIds).toContain(venue1.id);
    });

    it('should return 404 for non-existent entertainer', async () => {
      await request(app.getHttpServer())
        .get('/entertainers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /entertainers/:entertainerId', () => {
    it('should update entertainer as PLATFORM_ADMIN', async () => {
      const updateDto = {
        stageName: 'Updated Stage Name',
      };

      const response = await request(app.getHttpServer())
        .patch(`/entertainers/${entertainer2.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.stageName).toBe(updateDto.stageName);
    });

    it('should return 404 for non-existent entertainer', async () => {
      const updateDto = {
        stageName: 'Updated',
      };

      await request(app.getHttpServer())
        .patch('/entertainers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(updateDto)
        .expect(404);
    });
  });

  describe('DELETE /entertainers/:entertainerId', () => {
    it('should soft delete entertainer and cascade to QR codes', async () => {
      const newEntertainer = await prisma.entertainer.create({
        data: {
          stageName: 'To Delete',
          legalName: 'Delete Test',
          phone: '+2348066666666',
        },
      });

      // Create a QR code for this entertainer
      const qrCode = await prisma.qrCode.create({
        data: {
          publicToken: 'test-token-12345678901234567890',
          venueId: venue1.id,
          entertainerId: newEntertainer.id,
          location: 'Test Location',
        },
      });

      const response = await request(app.getHttpServer())
        .delete(`/entertainers/${newEntertainer.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body.isActive).toBe(false);

      // Verify entertainer still exists but deactivated
      const deletedEntertainer = await prisma.entertainer.findUnique({
        where: { id: newEntertainer.id },
      });
      expect(deletedEntertainer).not.toBeNull();
      expect(deletedEntertainer?.isActive).toBe(false);

      // Verify QR code was deactivated
      const deactivatedQrCode = await prisma.qrCode.findUnique({
        where: { id: qrCode.id },
      });
      expect(deactivatedQrCode?.isActive).toBe(false);
    });

    it('should return 404 for non-existent entertainer', async () => {
      await request(app.getHttpServer())
        .delete('/entertainers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });

  describe('POST /entertainers/:entertainerId/venues/:venueId', () => {
    it('should link entertainer to venue as PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .post(`/entertainers/${entertainer2.id}/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(201);

      expect(response.body.message).toContain('linked');

      // Verify link was created
      const link = await prisma.venueEntertainer.findFirst({
        where: {
          venueId: venue1.id,
          entertainerId: entertainer2.id,
        },
      });
      expect(link).not.toBeNull();
    });

    it('should link entertainer to venue as VENUE_ADMIN for their own venue', async () => {
      const response = await request(app.getHttpServer())
        .post(`/entertainers/${entertainer2.id}/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${venueAdmin2Token}`)
        .expect(201);

      expect(response.body.message).toContain('linked');
    });

    it('should return 403 when VENUE_ADMIN tries to link to another venue', async () => {
      await request(app.getHttpServer())
        .post(`/entertainers/${entertainer2.id}/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(403);
    });

    it('should return 409 for already-linked pair', async () => {
      const response = await request(app.getHttpServer())
        .post(`/entertainers/${entertainer1.id}/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(409);

      expect(response.body.message).toContain('already linked');
    });
  });

  describe('DELETE /entertainers/:entertainerId/venues/:venueId', () => {
    it('should unlink entertainer from venue without deleting entities', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/entertainers/${entertainer1.id}/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body.message).toContain('unlinked');

      // Verify link was deleted
      const link = await prisma.venueEntertainer.findFirst({
        where: {
          venueId: venue1.id,
          entertainerId: entertainer1.id,
        },
      });
      expect(link).toBeNull();

      // Verify entities still exist
      const venue = await prisma.venue.findUnique({ where: { id: venue1.id } });
      const entertainer = await prisma.entertainer.findUnique({ where: { id: entertainer1.id } });
      expect(venue).not.toBeNull();
      expect(entertainer).not.toBeNull();
    });

    it('should return 403 when VENUE_ADMIN tries to unlink from another venue', async () => {
      // Re-create the link for this test
      await prisma.venueEntertainer.create({
        data: {
          venueId: venue1.id,
          entertainerId: entertainer1.id,
        },
      });

      await request(app.getHttpServer())
        .delete(`/entertainers/${entertainer1.id}/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${venueAdmin2Token}`)
        .expect(403);
    });

    it('should return 404 for non-existent link', async () => {
      // entertainer2 is not linked to venue1
      const response = await request(app.getHttpServer())
        .delete(`/entertainers/${entertainer1.id}/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);

      expect(response.body.message).toMatch(/not linked|does not exist/i);
    });
  });
});
