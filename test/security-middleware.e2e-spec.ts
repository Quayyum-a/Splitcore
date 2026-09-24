import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { getCorsOptions } from '../src/config/cors.config';

describe('Security Middleware (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply security middleware (same as in main.ts)
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
          },
        },
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        },
      }),
    );

    app.enableCors(getCorsOptions('test'));

    // Payload size limits
    app.use(json({ limit: '1mb' }));
    app.use(urlencoded({ extended: true, limit: '1mb' }));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Helmet Security Headers', () => {
    it('should include Content-Security-Policy header', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('should include HSTS header', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(response.headers['strict-transport-security']).toContain('includeSubDomains');
    });

    it('should include X-Content-Type-Options header', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include X-Frame-Options header', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['x-frame-options']).toBeDefined();
    });
  });

  describe('CORS Configuration', () => {
    it('should allow requests from test environment origins', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should allow credentials', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should allow requests with no origin (mobile apps, curl)', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      // Should succeed without origin header
      expect(response.status).toBe(200);
    });
  });

  describe('Payload Size Limits', () => {
    it('should accept payloads under 1MB', async () => {
      // Create a payload just under 1MB (approximately 900KB)
      const largePayload = {
        data: 'x'.repeat(900 * 1024),
      };

      const response = await request(app.getHttpServer()).post('/auth/login').send(largePayload);

      // Should not be rejected for payload size (may fail validation for other reasons)
      expect(response.status).not.toBe(413);
    });

    it('should reject payloads exceeding 1MB', async () => {
      // Create a payload over 1MB (approximately 1.1MB)
      const tooLargePayload = {
        data: 'x'.repeat(1100 * 1024),
      };

      const response = await request(app.getHttpServer()).post('/auth/login').send(tooLargePayload);

      // Should be rejected with 413 Payload Too Large
      expect(response.status).toBe(413);
    });
  });
});
