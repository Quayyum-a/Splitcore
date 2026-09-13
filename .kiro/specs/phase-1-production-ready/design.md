# Phase 1 Production-Ready Backend - Technical Design Document

## Overview

This design document specifies the technical implementation for completing Phase 1 of the Splitcore backend system. The system currently has a working foundation (NestJS, PostgreSQL/Prisma, Redis/BullMQ, JWT authentication, logging, error handling). This phase extends the foundation to production-ready status through comprehensive testing infrastructure, security hardening, monitoring integration, deployment automation, and complete documentation.

### Goals

1. **Testing Excellence**: Achieve 80%+ code coverage with comprehensive unit and e2e tests
2. **Security Hardening**: Implement rate limiting, CORS policies, security headers, and payload validation
3. **Production Monitoring**: Integrate Sentry for error tracking and performance monitoring
4. **Deployment Automation**: Provide complete Render deployment configuration for API and worker services
5. **Documentation Quality**: Deliver comprehensive architecture and deployment documentation

### Target Infrastructure Stack

- **Backend Platform**: Render.com (Web Service + Worker)
- **Database**: Supabase PostgreSQL with PgBouncer pooling
- **Cache/Queue**: Upstash Redis
- **Monitoring**: Sentry error tracking and performance monitoring
- **CI/CD**: GitHub Actions

### Existing Foundation

The current system provides:
- **Framework**: NestJS 10.4.15 with TypeScript
- **Database**: PostgreSQL via Prisma ORM
- **Cache/Queue**: Redis with BullMQ for background jobs
- **Authentication**: JWT-based auth with bcrypt password hashing
- **Logging**: Structured logging with pino
- **Error Handling**: Global exception filter with standardized responses
- **Health Checks**: Basic database and Redis connectivity monitoring

## Architecture

### System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        CLIENT[API Clients]
    end
    
    subgraph "Render Infrastructure"
        subgraph "API Service"
            LB[Load Balancer]
            API1[API Instance 1]
            API2[API Instance 2]
        end
        
        subgraph "Worker Service"
            WORKER[Queue Worker Process]
        end
    end
    
    subgraph "External Services"
        SUPABASE[(Supabase PostgreSQL)]
        UPSTASH[(Upstash Redis)]
        SENTRY[Sentry Monitoring]
    end
    
    CLIENT -->|HTTPS| LB
    LB -->|Health Check /health| API1
    LB -->|Health Check /health| API2
    LB --> API1
    LB --> API2
    
    API1 -->|Connection Pool| SUPABASE
    API2 -->|Connection Pool| SUPABASE
    WORKER -->|Connection Pool| SUPABASE
    
    API1 -->|Job Queue| UPSTASH
    API2 -->|Job Queue| UPSTASH
    WORKER -->|Process Jobs| UPSTASH
    
    API1 -.->|Errors & Traces| SENTRY
    API2 -.->|Errors & Traces| SENTRY
    WORKER -.->|Errors & Traces| SENTRY
    
    style LB fill:#4A90E2
    style SUPABASE fill:#3ECF8E
    style UPSTASH fill:#00E9A3
    style SENTRY fill:#362D59
```

### Request Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant SecurityMiddleware
    participant ValidationPipe
    participant AuthGuard
    participant RolesGuard
    participant Controller
    participant Service
    participant Prisma
    participant Logger
    participant Sentry
    
    Client->>SecurityMiddleware: HTTP Request
    SecurityMiddleware->>SecurityMiddleware: Rate Limit Check
    SecurityMiddleware->>SecurityMiddleware: CORS Check
    SecurityMiddleware->>SecurityMiddleware: Helmet Headers
    SecurityMiddleware->>ValidationPipe: Request
    
    ValidationPipe->>ValidationPipe: Parse & Validate DTO
    alt Invalid Request
        ValidationPipe->>Logger: Log Validation Error
        ValidationPipe->>Client: 400 Bad Request
    end
    
    ValidationPipe->>AuthGuard: Valid Request
    AuthGuard->>AuthGuard: Parse JWT Token
    alt Invalid/Missing Token (and not @Public())
        AuthGuard->>Logger: Log Auth Failure
        AuthGuard->>Client: 401 Unauthorized
    end
    
    AuthGuard->>RolesGuard: Authenticated Request
    RolesGuard->>RolesGuard: Check Required Roles
    alt Insufficient Permissions
        RolesGuard->>Logger: Log Authorization Failure
        RolesGuard->>Client: 403 Forbidden
    end
    
    RolesGuard->>Controller: Authorized Request
    Controller->>Service: Business Logic Call
    Service->>Prisma: Database Query
    Prisma-->>Service: Data
    Service-->>Controller: Result
    Controller->>Logger: Log Success
    Controller->>Sentry: Record Performance Trace
    Controller-->>Client: 200 OK with Response
    
    alt Exception Occurs
        Service->>Logger: Log Error
        Service->>Sentry: Capture Exception
        Service->>Client: Error Response (4xx/5xx)
    end
```

### Module Architecture

```mermaid
graph TB
    subgraph "Core Modules"
        APP[AppModule]
        CONFIG[ConfigModule]
        LOGGER[LoggerModule]
        PRISMA[PrismaModule]
        REDIS[RedisModule]
    end
    
    subgraph "Feature Modules"
        AUTH[AuthModule]
        HEALTH[HealthModule]
        QUEUE[QueueModule]
    end
    
    subgraph "Infrastructure"
        FILTERS[AllExceptionsFilter]
        GUARDS[JwtAuthGuard<br/>RolesGuard]
        PIPES[ValidationPipe]
        THROTTLE[ThrottlerModule]
        SWAGGER[SwaggerModule]
        SENTRY_MOD[SentryCoreModule]
    end
    
    APP --> CONFIG
    APP --> LOGGER
    APP --> PRISMA
    APP --> REDIS
    APP --> AUTH
    APP --> HEALTH
    APP --> QUEUE
    APP --> THROTTLE
    APP --> SWAGGER
    
    APP -.->|Global Provider| FILTERS
    APP -.->|Global Provider| GUARDS
    APP -.->|Global Provider| PIPES
    
    AUTH --> PRISMA
    AUTH --> GUARDS
    HEALTH --> PRISMA
    HEALTH --> REDIS
    QUEUE --> REDIS
    
    CONFIG --> SENTRY_MOD
    FILTERS -.->|Report Errors| SENTRY_MOD
    
    style APP fill:#4A90E2
    style SENTRY_MOD fill:#362D59
```

## Components and Interfaces

### 1. Testing Infrastructure

#### Test Utilities Module

**File**: `test/utils/test-helpers.ts`

```typescript
interface TestDatabaseConfig {
  databaseUrl: string;
  schema?: string;
}

interface TestUser {
  id: string;
  email: string;
  role: Role;
  passwordHash: string;
  isActive: boolean;
}

interface TestAuthTokens {
  accessToken: string;
  userId: string;
  role: Role;
}

/**
 * Sets up isolated test database connection
 * Ensures each test suite uses separate schema
 */
export function setupTestDatabase(config?: Partial<TestDatabaseConfig>): Promise<PrismaClient>;

/**
 * Cleans up test database
 * Truncates all tables and resets sequences
 */
export function cleanupTestDatabase(prisma: PrismaClient): Promise<void>;

/**
 * Creates test user with specified role
 * Password is hashed using bcrypt
 */
export function createTestUser(
  prisma: PrismaClient,
  overrides?: Partial<Omit<TestUser, 'id' | 'passwordHash'>>
): Promise<TestUser>;

/**
 * Generates valid JWT token for e2e tests
 * Token validity set to 3600 seconds
 */
export function generateTestToken(userId: string, role: Role): string;

/**
 * Creates complete auth context for tests
 * Returns user entity and associated token
 */
export function createAuthenticatedTestContext(
  prisma: PrismaClient,
  role: Role
): Promise<{ user: TestUser; token: string }>;
```

**File**: `test/utils/test-factories.ts`

```typescript
interface UserFactoryOptions {
  email?: string;
  role?: Role;
  isActive?: boolean;
}

/**
 * Factory for creating test users with random data
 * Uses faker for generating realistic test data
 */
export class UserFactory {
  static create(prisma: PrismaClient, options?: UserFactoryOptions): Promise<TestUser>;
  static createMany(prisma: PrismaClient, count: number, options?: UserFactoryOptions): Promise<TestUser[]>;
}

interface JobFactoryOptions {
  name?: string;
  data?: Record<string, unknown>;
  opts?: JobsOptions;
}

/**
 * Factory for creating test queue jobs
 */
export class JobFactory {
  static create(queue: Queue, options?: JobFactoryOptions): Promise<Job>;
}
```

#### Jest Configuration

**File**: `jest.config.js`

```javascript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/instrument.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
  coverageReporters: ['json', 'lcov', 'text', 'html'],
};
```

**File**: `test/jest-e2e.json`

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFilesAfterEnv": ["<rootDir>/setup-e2e.ts"],
  "testTimeout": 30000
}
```

**File**: `test/setup-e2e.ts`

```typescript
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean database between tests
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `;
  
  for (const { tablename } of tables) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
    }
  }
});
```

### 2. Security Hardening

#### Rate Limiting Configuration

**File**: `src/common/throttler/throttler.config.ts`

```typescript
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export interface ThrottlerConfig {
  default: {
    ttl: number;    // Time window in milliseconds
    limit: number;  // Max requests per window
  };
  auth: {
    ttl: number;
    limit: number;
  };
}

export const throttlerConfig: ThrottlerConfig = {
  // General endpoints: 100 requests per 60 seconds per IP
  default: {
    ttl: 60000,
    limit: 100,
  },
  // Authentication endpoints: 5 requests per 60 seconds per IP
  auth: {
    ttl: 60000,
    limit: 5,
  },
};

export function getThrottlerModuleOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: throttlerConfig.default.ttl,
        limit: throttlerConfig.default.limit,
      },
      {
        name: 'auth',
        ttl: throttlerConfig.auth.ttl,
        limit: throttlerConfig.auth.limit,
      },
    ],
  };
}
```

**File**: `src/auth/auth.controller.ts` (updated)

```typescript
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  // Override default throttling with auth-specific limits
  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    // ... existing implementation
  }
}
```

#### CORS Configuration

**File**: `src/config/cors.config.ts`

```typescript
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function getCorsOptions(nodeEnv: string): CorsOptions {
  const allowedOrigins = {
    development: ['http://localhost:3000', 'http://localhost:3001'],
    test: ['http://localhost:3000'],
    production: [
      'https://splitcore.app',
      'https://www.splitcore.app',
      // Add additional production domains as needed
    ],
  };

  return {
    origin: (origin, callback) => {
      const origins = allowedOrigins[nodeEnv] || allowedOrigins.development;
      
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }
      
      if (origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
  };
}
```

#### Security Middleware Configuration

**File**: `src/main.ts` (updated)

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { getCorsOptions } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('nodeEnv', 'development');

  // Security headers
  app.use(helmet({
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
  }));

  // CORS configuration
  app.enableCors(getCorsOptions(nodeEnv));

  // Payload size limits
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  
  app.get(Logger).log(`Splitcore backend listening on port ${port}`);
}

bootstrap();
```

### 3. Monitoring Integration

#### Sentry Configuration

**File**: `instrument.ts` (created in project root)

```typescript
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Only initialize Sentry if DSN is provided
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: NODE_ENV,
    
    // Performance monitoring sample rate
    // 1.0 = 100% of transactions, 0.1 = 10% of transactions
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // Profiling sample rate
    profilesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    
    integrations: [
      nodeProfilingIntegration(),
      
      // HTTP instrumentation
      new Sentry.Integrations.Http({ tracing: true }),
      
      // Express instrumentation (NestJS uses Express internally)
      new Sentry.Integrations.Express({ 
        app: undefined // Will be set by NestJS integration
      }),
    ],
    
    // Filter sensitive data
    beforeSend(event, hint) {
      // Remove sensitive fields from event data
      if (event.request) {
        // Redact Authorization header
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['Authorization'];
        }
        
        // Redact sensitive body fields
        if (event.request.data) {
          const data = typeof event.request.data === 'string' 
            ? JSON.parse(event.request.data) 
            : event.request.data;
          
          if (data.password) data.password = '[REDACTED]';
          if (data.passwordHash) data.passwordHash = '[REDACTED]';
          if (data.token) data.token = '[REDACTED]';
          
          event.request.data = data;
        }
      }
      
      // Redact user sensitive fields
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      
      return event;
    },
    
    // Ignore expected errors
    ignoreErrors: [
      'UnauthorizedException',
      'ForbiddenException',
      'NotFoundException',
    ],
  });
}
```

**File**: `src/main.ts` (updated to import instrument first)

```typescript
// MUST be imported first to initialize Sentry before any other imports
import '../instrument';

import { NestFactory } from '@nestjs/core';
// ... rest of imports
```

**File**: `package.json` (updated start script)

```json
{
  "scripts": {
    "start:prod": "node --import ./instrument.js dist/main"
  }
}
```

#### Sentry Integration in Error Filter

**File**: `src/common/filters/all-exceptions.filter.ts` (updated)

```typescript
import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly logger: Logger) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? this.extractMessage(exception)
      : 'Internal server error';

    // Capture exceptions in Sentry (only 5xx errors)
    if (status >= 500) {
      Sentry.captureException(exception, {
        contexts: {
          http: {
            method: request.method,
            url: request.url,
            status_code: status,
          },
        },
        user: request.user ? {
          id: request.user.userId,
          role: request.user.role,
        } : undefined,
      });
    }

    // Log error
    this.logger.error(
      {
        exception,
        path: request.url,
        method: request.method,
        statusCode: status,
        userId: request.user?.userId,
      },
      'Exception caught by global filter',
    );

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: exception instanceof HttpException ? exception.name : 'InternalServerError',
      message,
    };

    response.status(status).json(errorResponse);
  }

  private extractMessage(exception: HttpException): string | string[] {
    const response = exception.getResponse();
    return typeof response === 'object' && 'message' in response
      ? response.message
      : exception.message;
  }
}
```

### 4. Environment Management

#### Enhanced Configuration

**File**: `src/config/configuration.ts` (updated)

```typescript
export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  sentry: {
    dsn?: string;
    tracesSampleRate: number;
  };
  logLevel: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    url: process.env.DATABASE_URL!,
  },

  redis: {
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },

  sentry: {
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
});
```

**File**: `src/config/validation.schema.ts` (updated)

```typescript
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  
  PORT: Joi.number()
    .integer()
    .min(1)
    .max(65535)
    .default(3000),

  DATABASE_URL: Joi.string()
    .uri()
    .pattern(/^postgresql:\/\//)
    .required()
    .messages({
      'string.pattern.base': 'DATABASE_URL must be a valid PostgreSQL connection string',
      'any.required': 'DATABASE_URL is required. Format: postgresql://user:password@host:port/database',
    }),

  REDIS_HOST: Joi.string()
    .hostname()
    .required()
    .messages({
      'any.required': 'REDIS_HOST is required (hostname or IP address)',
    }),
  
  REDIS_PORT: Joi.number()
    .integer()
    .min(1)
    .max(65535)
    .default(6379),
  
  REDIS_PASSWORD: Joi.string()
    .allow('')
    .optional(),

  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .messages({
      'string.min': 'JWT_SECRET must be at least 32 characters long',
      'any.required': 'JWT_SECRET is required. Generate a secure random string.',
    }),
  
  JWT_EXPIRES_IN: Joi.string()
    .default('1d')
    .messages({
      'string.base': 'JWT_EXPIRES_IN must be a string (e.g., "1d", "7d", "24h")',
    }),

  SENTRY_DSN: Joi.string()
    .uri()
    .optional()
    .messages({
      'string.uri': 'SENTRY_DSN must be a valid URL',
    }),

  SENTRY_TRACES_SAMPLE_RATE: Joi.number()
    .min(0.0)
    .max(1.0)
    .default(0.1)
    .messages({
      'number.min': 'SENTRY_TRACES_SAMPLE_RATE must be between 0.0 and 1.0',
      'number.max': 'SENTRY_TRACES_SAMPLE_RATE must be between 0.0 and 1.0',
    }),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
});
```

#### Environment Files

**File**: `.env.production.example`

```bash
# Application
NODE_ENV=production
PORT=3000

# Database (Supabase PostgreSQL)
# Format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
DATABASE_URL="postgresql://postgres:Mavixess@2001@db.fhpvtkpfogrhzfrpzlbv.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10"

# Redis (Upstash)
REDIS_HOST=your-upstash-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-upstash-password

# Authentication
JWT_SECRET=your-secure-random-32-character-minimum-secret-here
JWT_EXPIRES_IN=7d

# Monitoring (Sentry)
SENTRY_DSN=https://23e3eec2c9ecd80a88baac4f263e9457@o4512081057349632.ingest.us.sentry.io/4512081094770688
SENTRY_TRACES_SAMPLE_RATE=0.1

# Logging
LOG_LEVEL=info
```

### 5. Database Connection Pooling

#### Prisma Configuration

**File**: `prisma/schema.prisma` (updated)

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["metrics"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ... existing models
```

**File**: `src/prisma/prisma.service.ts` (updated)

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    const databaseUrl = configService.get<string>('database.url')!;
    const nodeEnv = configService.get<string>('nodeEnv', 'development');

    // Connection pool configuration for production (Supabase)
    const connectionConfig = nodeEnv === 'production' ? {
      connection_limit: 10,      // Maximum connections
      pool_timeout: 20,           // Connection timeout (seconds)
      connect_timeout: 20,        // Initial connection timeout (seconds)
    } : {};

    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: nodeEnv === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
      
      // Enable query metrics in production
      if (this.configService.get('nodeEnv') === 'production') {
        this.$on('query' as never, (e: any) => {
          if (e.duration > 1000) {
            this.logger.warn(`Slow query detected: ${e.duration}ms - ${e.query}`);
          }
        });
      }
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Health check for database connectivity
   */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database ping failed', error);
      return false;
    }
  }
}
```

**Database URL Format for Supabase with PgBouncer:**

```
postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20&connect_timeout=20
```

### 6. API Documentation

#### Swagger Setup

**File**: `src/common/swagger/swagger.config.ts`

```typescript
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Splitcore API')
    .setDescription('Splitcore backend API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Serve interactive UI at /api/docs
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Splitcore API Docs',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  // Export OpenAPI spec as JSON file
  const outputPath = path.resolve(process.cwd(), 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), { encoding: 'utf8' });
}
```

**File**: `src/main.ts` (updated)

```typescript
import { setupSwagger } from './common/swagger/swagger.config';

async function bootstrap() {
  // ... existing setup
  
  // Setup Swagger documentation
  setupSwagger(app);
  
  // ... rest of bootstrap
}
```

#### DTO Documentation Example

**File**: `src/auth/dto/login.dto.ts` (updated)

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'admin@splitcore.app',
    format: 'email',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePassword123!',
    minLength: 8,
    format: 'password',
  })
  @IsString()
  @MinLength(8)
  password: string;
}

export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}
```

#### Controller Documentation Example

**File**: `src/auth/auth.controller.ts` (updated)

```typescript
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @Post('login')
  @ApiOperation({
    summary: 'Authenticate user',
    description: 'Authenticates user with email and password, returns JWT access token',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    schema: {
      example: {
        statusCode: 401,
        timestamp: '2024-01-15T10:30:00.000Z',
        path: '/auth/login',
        error: 'UnauthorizedException',
        message: 'Invalid credentials',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests',
    schema: {
      example: {
        statusCode: 429,
        message: 'ThrottlerException: Too Many Requests',
      },
    },
  })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }
}
```

### 7. Queue Worker Process

#### Worker Entry Point

**File**: `src/worker.ts`

```typescript
import '../instrument'; // Initialize Sentry first
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService);
  
  logger.log('Queue worker starting...');
  logger.log(`Redis: ${config.get('redis.host')}:${config.get('redis.port')}`);
  logger.log(`Environment: ${config.get('nodeEnv')}`);

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down gracefully...`);
    
    // Wait for current jobs to complete (max 30 seconds)
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await app.close();
    logger.log('Worker shut down complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log('Queue worker ready to process jobs');
}

bootstrap().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
```

**File**: `src/worker/worker.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { validationSchema } from '../config/validation.schema';
import { LoggerModule } from '../common/logger/logger.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
  ],
})
export class WorkerModule {}
```

**File**: `package.json` (updated scripts)

```json
{
  "scripts": {
    "start:worker": "ts-node -r tsconfig-paths/register src/worker.ts",
    "start:worker:dev": "nodemon --watch src --exec ts-node -r tsconfig-paths/register src/worker.ts",
    "start:worker:prod": "node --import ./instrument.js dist/worker.js"
  }
}
```

#### Redis Connection with Retry Logic

**File**: `src/redis/redis.service.ts` (updated)

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 12; // 12 attempts = 60 seconds
  private readonly reconnectInterval = 5000; // 5 seconds

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  private async connect(): Promise<void> {
    const host = this.configService.get<string>('redis.host')!;
    const port = this.configService.get<number>('redis.port')!;
    const password = this.configService.get<string>('redis.password');

    this.client = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > this.maxReconnectAttempts) {
          this.logger.error(
            `Failed to connect to Redis after ${this.maxReconnectAttempts} attempts. Exiting...`
          );
          process.exit(1);
        }
        const delay = Math.min(times * this.reconnectInterval, 10000);
        this.logger.warn(`Reconnecting to Redis... (attempt ${times}/${this.maxReconnectAttempts})`);
        return delay;
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connection established');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.isConnected = false;
    });

    // Wait for initial connection
    try {
      await this.client.ping();
      this.logger.log('Redis ping successful');
    } catch (error) {
      this.logger.error('Redis initial connection failed', error);
      throw error;
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis ping failed', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }
}
```

### 8. Deployment Configuration

#### Render Blueprint

**File**: `render.yaml`

```yaml
services:
  # API Web Service
  - type: web
    name: splitcore-api
    runtime: node
    region: oregon
    plan: starter
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npm run start:prod
    healthCheckPath: /health
    autoDeploy: true
    branch: main
    
    envVars:
      - key: NODE_ENV
        value: production
      
      - key: PORT
        value: 3000
      
      - key: DATABASE_URL
        sync: false
        # Set in Render dashboard:
        # postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10
      
      - key: REDIS_HOST
        sync: false
        # Set in Render dashboard from Upstash
      
      - key: REDIS_PORT
        value: 6379
      
      - key: REDIS_PASSWORD
        sync: false
        # Set in Render dashboard from Upstash
      
      - key: JWT_SECRET
        generateValue: true
        # Or set manually to a secure random string (min 32 chars)
      
      - key: JWT_EXPIRES_IN
        value: 7d
      
      - key: SENTRY_DSN
        value: https://23e3eec2c9ecd80a88baac4f263e9457@o4512081057349632.ingest.us.sentry.io/4512081094770688
      
      - key: SENTRY_TRACES_SAMPLE_RATE
        value: 0.1
      
      - key: LOG_LEVEL
        value: info

  # Queue Worker Service
  - type: worker
    name: splitcore-worker
    runtime: node
    region: oregon
    plan: starter
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npm run start:worker:prod
    autoDeploy: true
    branch: main
    
    envVars:
      - key: NODE_ENV
        value: production
      
      - key: DATABASE_URL
        sync: false
        # Must match API service DATABASE_URL
      
      - key: REDIS_HOST
        sync: false
        # Must match API service REDIS_HOST
      
      - key: REDIS_PORT
        value: 6379
      
      - key: REDIS_PASSWORD
        sync: false
        # Must match API service REDIS_PASSWORD
      
      - key: JWT_SECRET
        sync: false
        # Must match API service JWT_SECRET
      
      - key: JWT_EXPIRES_IN
        value: 7d
      
      - key: SENTRY_DSN
        value: https://23e3eec2c9ecd80a88baac4f263e9457@o4512081057349632.ingest.us.sentry.io/4512081094770688
      
      - key: SENTRY_TRACES_SAMPLE_RATE
        value: 0.1
      
      - key: LOG_LEVEL
        value: info
```

## Data Models

### Existing Schema

The current Prisma schema includes:

```prisma
enum Role {
  PLATFORM_ADMIN
  VENUE_ADMIN
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         Role
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

No schema changes are required for Phase 1.

## Testing Strategy

### Why Property-Based Testing Is Not Applicable

Property-based testing is not appropriate for this feature because:

1. **Infrastructure as Code**: The Render deployment configuration (render.yaml) is declarative configuration, not transformable logic. Appropriate testing: snapshot tests and manual deployment verification.

2. **Integration Testing Domain**: Most requirements involve integration with external services (Supabase, Upstash, Sentry, Render). These are best validated through integration tests with representative examples rather than property-based tests.

3. **Configuration Validation**: Environment variable validation is schema-based (Joi), best tested with example-based tests covering valid and invalid cases.

4. **No Universal Properties**: The requirements do not define universal properties that should hold across a wide input space. They specify concrete behaviors with external systems.

### Testing Approach

This feature uses:

1. **Unit Tests**: Specific test cases for parsers, validators, and utilities
   - JWT token generation and validation
   - Password hashing round-trips
   - Environment variable parsing edge cases
   - Rate limiting logic

2. **Integration Tests**: E2E tests with real external service connections
   - Authentication flows with database
   - Queue job processing with Redis
   - Health checks with database and Redis
   - Error handling with Sentry capture

3. **Snapshot Tests**: Configuration validation
   - OpenAPI specification generation
   - Swagger documentation structure
   - Render YAML structure

4. **Manual Testing**: Deployment verification
   - Render deployment process
   - Supabase connection with SSL
   - Upstash Redis connectivity
   - Sentry error capture

## Error Handling

### Error Response Format

All errors follow a consistent structure:

```typescript
interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  error: string;
  message: string | string[];
}
```

### Error Categories

1. **Validation Errors (400)**
   - Invalid request body structure
   - Missing required fields
   - Type mismatches
   - Constraint violations

2. **Authentication Errors (401)**
   - Missing JWT token
   - Invalid JWT signature
   - Expired JWT token
   - Invalid credentials

3. **Authorization Errors (403)**
   - Insufficient role permissions
   - Resource access denied

4. **Not Found Errors (404)**
   - Resource does not exist
   - Endpoint not found

5. **Rate Limiting Errors (429)**
   - Exceeded request quota
   - IP-based throttling triggered

6. **Payload Size Errors (413)**
   - Request body exceeds 1MB limit

7. **Server Errors (500)**
   - Unhandled exceptions
   - Database connection failures
   - Redis connection failures
   - Internal processing errors

### Error Handling Flow

```mermaid
graph TB
    START[Exception Thrown] --> FILTER[AllExceptionsFilter]
    
    FILTER --> CHECK_TYPE{Exception Type?}
    
    CHECK_TYPE -->|HttpException| EXTRACT_HTTP[Extract Status & Message]
    CHECK_TYPE -->|Unknown Error| SET_500[Set Status 500]
    
    EXTRACT_HTTP --> CHECK_STATUS{Status Code?}
    SET_500 --> LOG_ERROR[Log Error]
    
    CHECK_STATUS -->|>= 500| LOG_ERROR
    CHECK_STATUS -->|< 500| LOG_WARN[Log Warning]
    
    LOG_ERROR --> CAPTURE_SENTRY[Capture in Sentry]
    LOG_WARN --> BUILD_RESPONSE[Build Error Response]
    CAPTURE_SENTRY --> BUILD_RESPONSE
    
    BUILD_RESPONSE --> SEND_RESPONSE[Send JSON Response]
    SEND_RESPONSE --> END[End]
    
    style LOG_ERROR fill:#ff6b6b
    style CAPTURE_SENTRY fill:#362D59
    style SEND_RESPONSE fill:#4ECDC4
```

### Sensitive Data Redaction

The following fields are automatically redacted from logs and error reports:

- `password`
- `passwordHash`
- `token`
- `Authorization` headers
- `bvn` (Bank Verification Number)
- `nin` (National Identification Number)

Redaction applies to:
- Structured logs (pino)
- Sentry error reports
- Sentry performance traces

## Testing Strategy

### Test Pyramid

```
        /\
       /  \
      / E2E \       10% - End-to-End Integration Tests
     /______\
    /        \
   / Integration\  20% - Module Integration Tests
  /____________\
 /              \
/   Unit Tests   \ 70% - Unit Tests
/__________________\
```

### Unit Tests (70% of tests)

**Target Coverage**: 80% minimum (statements, branches, functions)

**Test Categories**:

1. **Service Logic Tests**
   - `auth.service.spec.ts`: JWT generation, password validation, user lookup
   - `prisma.service.spec.ts`: Connection management, health checks
   - `redis.service.spec.ts`: Connection retry logic, ping functionality

2. **Guard Tests**
   - `jwt-auth.guard.spec.ts`: Token validation, @Public() decorator handling
   - `roles.guard.spec.ts`: Role-based access control, permission checks

3. **Filter Tests**
   - `all-exceptions.filter.spec.ts`: Error formatting, status code mapping, Sentry integration

4. **Validation Tests**
   - Environment variable validation (valid/invalid scenarios)
   - DTO validation (class-validator decorators)
   - Configuration schema validation (Joi)

5. **Utility Tests**
   - Test helpers (user factories, token generation)
   - Data sanitization (log redaction)

**Example Unit Test**:

```typescript
// src/auth/auth.service.spec.ts
describe('AuthService', () => {
  describe('validateUser', () => {
    it('should return user when credentials are valid', async () => {
      const user = await service.validateUser('test@example.com', 'password123');
      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      await expect(
        service.validateUser('test@example.com', 'wrongpassword')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      await expect(
        service.validateUser('nonexistent@example.com', 'password123')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('should generate valid JWT token', async () => {
      const user = { userId: '123', role: Role.VENUE_ADMIN };
      const result = await service.login(user);
      
      expect(result.accessToken).toBeDefined();
      
      // Verify token can be decoded
      const decoded = jwt.verify(result.accessToken, jwtSecret);
      expect(decoded.sub).toBe('123');
      expect(decoded.role).toBe(Role.VENUE_ADMIN);
    });
  });
});
```

### Integration Tests (20% of tests)

**File**: `test/auth.e2e-spec.ts`

```typescript
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTestDatabase(prisma);
  });

  describe('POST /auth/login', () => {
    it('should authenticate user with valid credentials', async () => {
      const user = await createTestUser(prisma, {
        email: 'test@example.com',
        role: Role.VENUE_ADMIN,
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      await createTestUser(prisma, {
        email: 'test@example.com',
        role: Role.VENUE_ADMIN,
      });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        })
        .expect(401);
    });

    it('should enforce rate limiting on auth endpoints', async () => {
      const user = await createTestUser(prisma);

      // Make 6 requests (limit is 5 per 60 seconds)
      for (let i = 0; i < 6; i++) {
        const response = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: user.email,
            password: 'password123',
          });

        if (i < 5) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }
    });
  });
});
```

**File**: `test/health.e2e-spec.ts`

```typescript
describe('Health (e2e)', () => {
  it('should return 200 when all dependencies are healthy', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.info.database.status).toBe('up');
    expect(response.body.info.redis.status).toBe('up');
  });

  it('should return 503 when database is down', async () => {
    // Simulate database failure by closing connection
    await prisma.$disconnect();

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.error.database.status).toBe('down');
  });
});
```

**File**: `test/queue.e2e-spec.ts`

```typescript
describe('Queue Processing (e2e)', () => {
  it('should enqueue and process job successfully', async () => {
    const job = await JobFactory.create(queue, {
      name: 'test-job',
      data: { message: 'test' },
    });

    // Wait for job to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    const completedJob = await queue.getJob(job.id);
    expect(completedJob.isCompleted()).toBe(true);
  });

  it('should retry failed jobs', async () => {
    const job = await JobFactory.create(queue, {
      name: 'failing-job',
      data: { shouldFail: true },
      opts: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 1000 },
      },
    });

    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 5000));

    const failedJob = await queue.getJob(job.id);
    expect(failedJob.attemptsMade).toBe(3);
    expect(failedJob.isFailed()).toBe(true);
  });
});
```

### E2E Tests (10% of tests)

Full user journey tests combining multiple features:

**File**: `test/user-journey.e2e-spec.ts`

```typescript
describe('User Journey (e2e)', () => {
  it('should complete full authentication and protected endpoint access flow', async () => {
    // 1. Create user
    const user = await createTestUser(prisma, {
      email: 'journey@example.com',
      role: Role.VENUE_ADMIN,
    });

    // 2. Login
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'journey@example.com',
        password: 'password123',
      })
      .expect(200);

    const token = loginResponse.body.accessToken;

    // 3. Access protected endpoint
    await request(app.getHttpServer())
      .get('/protected-resource')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 4. Try accessing admin-only endpoint (should fail)
    await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
```

### Coverage Requirements

**File**: `jest.config.js` (coverage thresholds)

```javascript
module.exports = {
  // ... other config
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
```

### Test Execution Commands

```bash
# Run all unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run unit tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Run specific test file
npm test -- auth.service.spec.ts

# Run tests matching pattern
npm test -- --testNamePattern="should validate user"
```

### CI/CD Testing

**File**: `.github/workflows/ci.yml` (updated)

```yaml
- name: Unit tests
  run: npm test -- --ci --coverage --maxWorkers=2

- name: E2E tests
  run: npm run test:e2e -- --ci --maxWorkers=1

- name: Check coverage thresholds
  run: |
    if [ -f coverage/coverage-summary.json ]; then
      npm run test:cov
    fi

- name: Upload coverage to Codecov (optional)
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    flags: unittests
    name: splitcore-coverage
```

## Documentation

### Architecture Documentation Structure

```
docs/
├── architecture/
│   ├── 001-system-overview.md
│   ├── 002-module-architecture.md
│   ├── 003-authentication-flow.md
│   ├── 004-queue-processing.md
│   ├── 005-error-handling.md
│   ├── 006-logging-strategy.md
│   └── 007-database-design.md
├── deployment/
│   ├── 001-infrastructure-setup.md
│   ├── 002-render-deployment.md
│   ├── 003-environment-variables.md
│   ├── 004-database-migrations.md
│   └── 005-troubleshooting.md
└── api/
    └── openapi.json (generated)
```

### Sample Architecture Document

**File**: `docs/architecture/003-authentication-flow.md`

```markdown
# Authentication Flow

## Overview

Splitcore uses JWT-based authentication with role-based access control (RBAC).

## Authentication Sequence

\`\`\`mermaid
sequenceDiagram
    actor User
    participant Client
    participant API
    participant AuthService
    participant Prisma
    participant JWT

    User->>Client: Enter credentials
    Client->>API: POST /auth/login
    API->>AuthService: validateUser(email, password)
    AuthService->>Prisma: findUnique({ email })
    Prisma-->>AuthService: User record
    AuthService->>AuthService: bcrypt.compare(password, hash)
    alt Valid credentials
        AuthService-->>API: User (without password)
        API->>JWT: sign({ userId, role })
        JWT-->>API: Access token
        API-->>Client: { accessToken }
        Client->>Client: Store token
        Client->>API: Subsequent requests with Authorization header
    else Invalid credentials
        AuthService-->>API: Throw UnauthorizedException
        API-->>Client: 401 Unauthorized
    end
\`\`\`

## JWT Token Structure

### Payload
\`\`\`json
{
  "sub": "user-uuid",
  "role": "VENUE_ADMIN",
  "iat": 1705320000,
  "exp": 1705925600
}
\`\`\`

### Token Validation

1. **JwtAuthGuard** extracts token from Authorization header
2. Verifies signature using JWT_SECRET
3. Checks expiration timestamp
4. Adds user context to request object

## Role-Based Access Control

### Roles
- \`PLATFORM_ADMIN\`: Full system access
- \`VENUE_ADMIN\`: Venue-specific access

### Usage
\`\`\`typescript
@Roles(Role.PLATFORM_ADMIN)
@Get('admin/dashboard')
getDashboard() {
  // Only accessible by PLATFORM_ADMIN
}
\`\`\`

## Public Endpoints

Use \`@Public()\` decorator to bypass authentication:

\`\`\`typescript
@Public()
@Post('auth/login')
login() {
  // No authentication required
}
\`\`\`
```

### Deployment Guide

**File**: `docs/deployment/002-render-deployment.md`

```markdown
# Render Deployment Guide

## Prerequisites

1. Supabase account with PostgreSQL database
2. Upstash account with Redis instance
3. Sentry account with project created
4. Render account
5. GitHub repository with code

## Step 1: Database Setup (Supabase)

### 1.1 Create Project
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Enter project details
4. Wait for database provisioning (2-3 minutes)

### 1.2 Get Connection String
1. Navigate to Settings > Database
2. Copy "Connection String" under "Connection Info"
3. Replace \`[YOUR-PASSWORD]\` with your database password
4. Add connection pooling parameters:
   \`\`\`
   ?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20
   \`\`\`

**Verification**: Test connection using psql:
\`\`\`bash
psql "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres"
\`\`\`

## Step 2: Redis Setup (Upstash)

### 2.1 Create Database
1. Go to https://console.upstash.com/
2. Click "Create Database"
3. Select region (choose closest to your Render region)
4. Select "Regional" plan (or "Global" for multi-region)

### 2.2 Get Credentials
1. Click on your database
2. Copy "Endpoint" (REDIS_HOST)
3. Copy "Port" (usually 6379)
4. Copy "Password"

**Verification**: Test connection using redis-cli:
\`\`\`bash
redis-cli -h your-host.upstash.io -p 6379 -a your-password ping
\`\`\`

## Step 3: Sentry Setup

### 3.1 Create Project
1. Go to https://sentry.io/
2. Navigate to Projects > Create Project
3. Select "Node.js" platform
4. Enter project name: "splitcore-backend"

### 3.2 Get DSN
1. Go to Settings > Projects > splitcore-backend
2. Navigate to Client Keys (DSN)
3. Copy the DSN URL

DSN is already configured:
\`\`\`
https://23e3eec2c9ecd80a88baac4f263e9457@o4512081057349632.ingest.us.sentry.io/4512081094770688
\`\`\`

## Step 4: Render Deployment

### 4.1 Connect Repository
1. Go to https://dashboard.render.com/
2. Click "New" > "Blueprint"
3. Connect your GitHub account
4. Select \`splitcore-backend\` repository

### 4.2 Configure Environment Variables

Render will read \`render.yaml\` and create two services:
- \`splitcore-api\` (Web Service)
- \`splitcore-worker\` (Worker)

For each service, set these environment variables:

#### Required Variables (set in Render dashboard)
\`\`\`bash
DATABASE_URL=postgresql://postgres:Mavixess@2001@db.fhpvtkpfogrhzfrpzlbv.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10

REDIS_HOST=your-upstash-host.upstash.io
REDIS_PASSWORD=your-upstash-password

JWT_SECRET=<generate-32-char-random-string>
\`\`\`

#### Generate JWT Secret
\`\`\`bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32
\`\`\`

### 4.3 Deploy
1. Click "Apply" to create services
2. Render will:
   - Build both API and Worker services
   - Run database migrations (\`npx prisma migrate deploy\`)
   - Start services
3. Monitor deployment logs

**Expected Deploy Time**: 5-7 minutes

### 4.4 Verify Deployment

1. **Health Check**
   \`\`\`bash
   curl https://splitcore-api.onrender.com/health
   \`\`\`
   Expected response:
   \`\`\`json
   {
     "status": "ok",
     "info": {
       "database": { "status": "up" },
       "redis": { "status": "up" }
     }
   }
   \`\`\`

2. **API Documentation**
   Visit: \`https://splitcore-api.onrender.com/api/docs\`

3. **Sentry Integration**
   - Trigger an error endpoint
   - Check Sentry dashboard for error report

## Step 5: Database Migrations

Run migrations on first deployment:

\`\`\`bash
# Render runs this automatically in build command
npx prisma migrate deploy
\`\`\`

## Step 6: Seed Admin User (Optional)

Create initial admin user:

\`\`\`bash
# Connect to Render shell
render shell splitcore-api

# Run seed script
npm run prisma:seed
\`\`\`

## Troubleshooting

### API Service Won't Start

**Symptom**: Health check fails, service keeps restarting

**Diagnosis**:
1. Check Render logs: Dashboard > splitcore-api > Logs
2. Look for error messages in startup logs

**Common Causes**:
- Missing environment variables
- Database connection failure
- Redis connection failure

**Solutions**:
\`\`\`bash
# Test database connection
psql "$DATABASE_URL"

# Test Redis connection
redis-cli -u "$REDIS_URL" ping
\`\`\`

### Worker Service Not Processing Jobs

**Symptom**: Jobs stay in "waiting" status

**Diagnosis**:
1. Check worker logs: Dashboard > splitcore-worker > Logs
2. Verify Redis connection

**Solutions**:
- Ensure REDIS_HOST, REDIS_PORT, REDIS_PASSWORD match API service
- Check worker is running: Dashboard > splitcore-worker > Status should be "Running"

### High Response Times

**Symptom**: API responses take > 1 second

**Common Causes**:
- Database connection pool exhausted
- Slow queries
- Cold start (free tier)

**Solutions**:
1. Upgrade to Starter plan (avoids cold starts)
2. Check Sentry performance monitoring for slow transactions
3. Review database connection pool settings in Prisma

### Rate Limiting Issues

**Symptom**: Legitimate requests receiving 429 errors

**Solutions**:
- Adjust throttler configuration in \`src/common/throttler/throttler.config.ts\`
- Consider IP whitelisting for known clients
- Implement Redis-backed rate limiting for distributed rate limits

## Monitoring

### Key Metrics to Watch

1. **Response Time** (Render Metrics)
   - Target: < 200ms p95
   - Alert if > 1000ms

2. **Error Rate** (Sentry)
   - Target: < 0.1%
   - Alert on new error types

3. **Queue Length** (Redis)
   \`\`\`bash
   redis-cli -u "$REDIS_URL" llen bull:default:wait
   \`\`\`
   - Target: < 100 jobs
   - Alert if > 1000

4. **Database Connections** (Supabase Dashboard)
   - Target: < 8 concurrent (out of 10 max)
   - Alert if exhausted

## Rollback Procedure

If deployment fails:

1. Go to Render Dashboard > splitcore-api > Deploys
2. Find last successful deploy
3. Click "Redeploy"
4. Repeat for splitcore-worker

## Next Steps

After successful deployment:
1. Set up monitoring alerts in Sentry
2. Configure custom domain in Render
3. Set up SSL certificate (automatic with custom domain)
4. Configure GitHub auto-deploy for main branch
```

## Summary

This design document specifies the complete implementation for Phase 1 Production-Ready Backend. The key technical decisions include:

1. **Testing Infrastructure**: Jest with 80% coverage threshold, comprehensive test utilities, isolated test databases
2. **Security Stack**: @nestjs/throttler for rate limiting, helmet for security headers, CORS whitelist, 1MB payload limits
3. **Monitoring**: @sentry/nestjs with instrument.ts initialization, 10% trace sampling, sensitive data redaction
4. **Environment Management**: Joi validation schemas, multi-environment configs, descriptive error messages
5. **Database Pooling**: Prisma with connection_limit=10, pool_timeout=20s, SSL required for Supabase
6. **API Documentation**: @nestjs/swagger with OpenAPI 3.0, interactive UI at /api/docs, automatic spec generation
7. **Worker Architecture**: Separate worker.ts entry point, Redis retry logic (12 attempts over 60s), graceful shutdown
8. **Deployment**: render.yaml blueprint with API and worker services, health checks, environment variable management

The implementation follows NestJS best practices, ensures production-readiness through comprehensive testing and monitoring, and provides complete documentation for deployment and troubleshooting.

