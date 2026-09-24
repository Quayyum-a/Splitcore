import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

describe('Venues (e2e)', () => {
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply global validation pipe to match main.ts
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

    // Clean database
    await cleanDatabase();

    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  async function cleanDatabase() {
    // Delete in order to respect foreign key constraints
    await prisma.user.deleteMany();
    await prisma.venue.deleteMany();
  }

  async function setupTestData() {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Create venues first
    venue1 = await prisma.venue.create({
      data: {
        name: 'Venue One',
        slug: 'venue-one',
        location: 'Location One',
        logoUrl: 'https://example.com/venue1.png',
      },
    });

    venue2 = await prisma.venue.create({
      data: {
        name: 'Venue Two',
        slug: 'venue-two',
        location: 'Location Two',
      },
    });

    // Create platform admin
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

    // Create venue admin for venue1
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

    // Create venue admin for venue2
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

  describe('POST /venues', () => {
    it('should create a venue as PLATFORM_ADMIN', async () => {
      const createDto = {
        name: 'New Venue',
        slug: 'new-venue',
        location: 'New Location',
        logoUrl: 'https://example.com/new.png',
      };

      const response = await request(app.getHttpServer())
        .post('/venues')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toMatchObject({
        name: createDto.name,
        slug: createDto.slug,
        location: createDto.location,
        logoUrl: createDto.logoUrl,
        isActive: true,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
    });

    it('should return 401 for unauthenticated request', async () => {
      const createDto = {
        name: 'Test Venue',
        slug: 'test-venue',
        location: 'Test Location',
      };

      await request(app.getHttpServer()).post('/venues').send(createDto).expect(401);
    });

    it('should return 403 for VENUE_ADMIN role', async () => {
      const createDto = {
        name: 'Test Venue',
        slug: 'test-venue-forbidden',
        location: 'Test Location',
      };

      await request(app.getHttpServer())
        .post('/venues')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send(createDto)
        .expect(403);
    });

    it('should return 400 for invalid slug format', async () => {
      const createDto = {
        name: 'Test Venue',
        slug: 'Invalid_Slug!', // Uppercase and special chars
        location: 'Test Location',
      };

      const response = await request(app.getHttpServer())
        .post('/venues')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(400);

      // Validation pipe returns an array of messages
      expect(Array.isArray(response.body.message)).toBe(true);
      expect(
        response.body.message.some((msg: string) =>
          msg.includes('lowercase letters, numbers, and hyphens'),
        ),
      ).toBe(true);
    });

    it('should return 409 for duplicate slug', async () => {
      const createDto = {
        name: 'Duplicate Venue',
        slug: venue1.slug, // Use existing slug
        location: 'Test Location',
      };

      const response = await request(app.getHttpServer())
        .post('/venues')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });

    it('should return 400 for missing required fields', async () => {
      const createDto = {
        name: 'Test Venue',
        // Missing slug and location
      };

      await request(app.getHttpServer())
        .post('/venues')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(createDto)
        .expect(400);
    });
  });

  describe('GET /venues', () => {
    it('should return all venues for PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);

      const venueIds = response.body.map((v: any) => v.id);
      expect(venueIds).toContain(venue1.id);
      expect(venueIds).toContain(venue2.id);
    });

    it('should return only assigned venue for VENUE_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/venues')
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe(venue1.id);
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/venues').expect(401);
    });
  });

  describe('GET /venues/:venueId', () => {
    it('should return venue details for PLATFORM_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get(`/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: venue1.id,
        name: venue1.name,
        slug: venue1.slug,
      });
    });

    it('should return venue details for VENUE_ADMIN of that venue', async () => {
      const response = await request(app.getHttpServer())
        .get(`/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(200);

      expect(response.body.id).toBe(venue1.id);
    });

    it('should return 404 for non-existent venue', async () => {
      await request(app.getHttpServer())
        .get('/venues/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /venues/:venueId', () => {
    it('should update venue as PLATFORM_ADMIN', async () => {
      const updateDto = {
        name: 'Updated Venue Name',
        location: 'Updated Location',
      };

      const response = await request(app.getHttpServer())
        .patch(`/venues/${venue1.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body).toMatchObject({
        id: venue1.id,
        name: updateDto.name,
        location: updateDto.location,
        slug: venue1.slug, // Preserved
      });
    });

    it('should update venue as VENUE_ADMIN for their own venue', async () => {
      const updateDto = {
        location: 'New Location for Venue 2',
      };

      const response = await request(app.getHttpServer())
        .patch(`/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${venueAdmin2Token}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.location).toBe(updateDto.location);
    });

    it('should return 403 when VENUE_ADMIN tries to update another venue', async () => {
      const updateDto = {
        name: 'Forbidden Update',
      };

      await request(app.getHttpServer())
        .patch(`/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .send(updateDto)
        .expect(403);
    });

    it('should return 404 for non-existent venue', async () => {
      const updateDto = {
        name: 'Updated Name',
      };

      await request(app.getHttpServer())
        .patch('/venues/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send(updateDto)
        .expect(404);
    });
  });

  describe('DELETE /venues/:venueId', () => {
    it('should soft delete venue (set isActive to false)', async () => {
      // Create a new venue to delete
      const venueToDelete = await prisma.venue.create({
        data: {
          name: 'Venue To Delete',
          slug: 'venue-to-delete',
          location: 'Delete Location',
        },
      });

      const response = await request(app.getHttpServer())
        .delete(`/venues/${venueToDelete.id}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(response.body.isActive).toBe(false);

      // Verify venue still exists in database
      const deletedVenue = await prisma.venue.findUnique({
        where: { id: venueToDelete.id },
      });
      expect(deletedVenue).not.toBeNull();
      expect(deletedVenue?.isActive).toBe(false);
    });

    it('should allow VENUE_ADMIN to soft delete their own venue', async () => {
      // Create a venue and assign to a new venue admin
      const testVenue = await prisma.venue.create({
        data: {
          name: 'Test Venue For Admin',
          slug: 'test-venue-for-admin',
          location: 'Admin Location',
        },
      });

      const passwordHash = await bcrypt.hash('Password123!', 10);
      const testVenueAdmin = await prisma.user.create({
        data: {
          email: 'testvenueadmin@example.com',
          passwordHash,
          role: Role.VENUE_ADMIN,
          venueId: testVenue.id,
        },
      });

      const testVenueAdminToken = jwtService.sign({
        sub: testVenueAdmin.id,
        email: testVenueAdmin.email,
        role: testVenueAdmin.role,
        venueId: testVenueAdmin.venueId,
      });

      const response = await request(app.getHttpServer())
        .delete(`/venues/${testVenue.id}`)
        .set('Authorization', `Bearer ${testVenueAdminToken}`)
        .expect(200);

      expect(response.body.isActive).toBe(false);
    });

    it('should return 403 when VENUE_ADMIN tries to delete another venue', async () => {
      await request(app.getHttpServer())
        .delete(`/venues/${venue2.id}`)
        .set('Authorization', `Bearer ${venueAdmin1Token}`)
        .expect(403);
    });

    it('should return 404 for non-existent venue', async () => {
      await request(app.getHttpServer())
        .delete('/venues/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);
    });
  });
});
