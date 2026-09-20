# System Overview

## Table of Contents

1. [Introduction](#introduction)
2. [Overall Architecture](#overall-architecture)
3. [Deployment Architecture](#deployment-architecture)
4. [Technology Stack](#technology-stack)
5. [Component Diagram](#component-diagram)
6. [Data Flow](#data-flow)
7. [Security Architecture](#security-architecture)

---

## Introduction

Splitcore is a production-ready backend system built on NestJS, designed for scalability, reliability, and maintainability. The system follows a microservices-oriented architecture with separate API and worker processes, leveraging modern cloud infrastructure for PostgreSQL database, Redis caching/queuing, and comprehensive monitoring.

### Key Characteristics

- **Framework**: NestJS with TypeScript for type-safe, modular development
- **Database**: PostgreSQL with Prisma ORM for type-safe database access
- **Caching/Queuing**: Redis with BullMQ for background job processing
- **Authentication**: JWT-based authentication with bcrypt password hashing
- **Monitoring**: Sentry integration for error tracking and performance monitoring
- **Deployment**: Cloud-native deployment on Render with managed services

---

## Overall Architecture

The system follows a layered architecture pattern with clear separation of concerns:

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Web Clients]
        MOBILE[Mobile Apps]
        API_CLIENT[API Integrations]
    end
    
    subgraph "API Layer"
        LB[Load Balancer]
        API[API Service<br/>Multiple Instances]
    end
    
    subgraph "Background Processing"
        WORKER[Queue Worker Service]
    end
    
    subgraph "Data Layer"
        POSTGRES[(PostgreSQL<br/>Supabase)]
        REDIS[(Redis<br/>Upstash)]
    end
    
    subgraph "External Services"
        SENTRY[Sentry<br/>Error Tracking]
    end
    
    WEB -->|HTTPS| LB
    MOBILE -->|HTTPS| LB
    API_CLIENT -->|HTTPS| LB
    
    LB -->|Routes Requests| API
    
    API -->|Database Queries| POSTGRES
    API -->|Enqueue Jobs| REDIS
    API -->|Cache Read/Write| REDIS
    API -.->|Error Reports| SENTRY
    
    WORKER -->|Process Jobs| REDIS
    WORKER -->|Database Operations| POSTGRES
    WORKER -.->|Error Reports| SENTRY
    
    style API fill:#4A90E2
    style WORKER fill:#7B68EE
    style POSTGRES fill:#3ECF8E
    style REDIS fill:#DC382D
    style SENTRY fill:#362D59
```

### Architectural Layers

1. **Presentation Layer**: REST API endpoints with OpenAPI documentation
2. **Application Layer**: Controllers and DTOs for request/response handling
3. **Business Logic Layer**: Services implementing core business logic
4. **Data Access Layer**: Prisma ORM for database operations
5. **Infrastructure Layer**: Redis, logging, monitoring, and security middleware

---

## Deployment Architecture

The system is deployed on Render.com with managed external services:

```mermaid
graph TB
    subgraph "Render Cloud Platform"
        subgraph "API Service (Web)"
            API1[API Instance 1]
            API2[API Instance 2]
            APIX[API Instance N]
            
            LB[Load Balancer<br/>Health Checks: /health]
        end
        
        subgraph "Worker Service"
            WORKER1[Worker Process]
        end
    end
    
    subgraph "Supabase"
        PG[(PostgreSQL 15<br/>with PgBouncer)]
        PGPOOL[Connection Pool<br/>Max: 10 connections]
    end
    
    subgraph "Upstash"
        REDIS[(Redis<br/>TLS Enabled)]
    end
    
    subgraph "Sentry"
        SENTRY[Error Tracking<br/>Performance Monitoring]
    end
    
    subgraph "GitHub"
        REPO[GitHub Repository<br/>main branch]
    end
    
    LB --> API1
    LB --> API2
    LB --> APIX
    
    API1 --> PGPOOL
    API2 --> PGPOOL
    APIX --> PGPOOL
    WORKER1 --> PGPOOL
    
    PGPOOL --> PG
    
    API1 --> REDIS
    API2 --> REDIS
    APIX --> REDIS
    WORKER1 --> REDIS
    
    API1 -.->|Traces & Errors| SENTRY
    API2 -.->|Traces & Errors| SENTRY
    APIX -.->|Traces & Errors| SENTRY
    WORKER1 -.->|Errors| SENTRY
    
    REPO -->|Auto Deploy| API1
    REPO -->|Auto Deploy| WORKER1
    
    style LB fill:#4A90E2
    style PG fill:#3ECF8E
    style REDIS fill:#DC382D
    style SENTRY fill:#362D59
    style REPO fill:#333
```

### Deployment Components

#### Render Services

**API Service (Web)**
- **Type**: Web Service
- **Runtime**: Node.js
- **Region**: Oregon
- **Plan**: Starter (scalable to higher tiers)
- **Build Command**: `npm ci --include=dev && npx prisma generate && npm run build`
- **Start Command**: `npm run start:prod`
- **Health Check**: `/health` endpoint
- **Auto-scaling**: Enabled based on traffic
- **Auto-deploy**: Triggered on push to `main` branch

**Worker Service**
- **Type**: Worker
- **Runtime**: Node.js
- **Region**: Oregon (same as API for low latency)
- **Plan**: Starter
- **Build Command**: `npm ci --include=dev && npx prisma generate && npm run build`
- **Start Command**: `npm run start:worker:prod`
- **Auto-deploy**: Triggered on push to `main` branch

#### External Managed Services

**Supabase PostgreSQL**
- **Database**: PostgreSQL 15
- **Connection**: SSL required
- **Pooling**: PgBouncer with transaction pooling
- **Connection Limit**: 10 per service instance
- **Backup**: Automated daily backups
- **Connection String Format**:
  ```
  postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10
  ```

**Upstash Redis**
- **Type**: Managed Redis
- **TLS**: Enabled
- **Region**: US-East (or nearest to Render Oregon)
- **Persistence**: Configurable
- **Connection**: TLS with password authentication

**Sentry**
- **Error Tracking**: Automatic exception capture
- **Performance Monitoring**: Request tracing with 10% sample rate
- **Release Tracking**: Integrated with deployment pipeline
- **Alerts**: Configurable for error thresholds

---

## Technology Stack

### Core Technologies

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Framework** | NestJS | 10.4.15 | Backend application framework |
| **Language** | TypeScript | 6.0.3 | Type-safe development |
| **Runtime** | Node.js | 20.x | JavaScript runtime |
| **Database** | PostgreSQL | 15 | Primary data store |
| **ORM** | Prisma | 5.22.0 | Type-safe database client |
| **Cache/Queue** | Redis | 7.x | Caching and job queue |
| **Queue Library** | BullMQ | 5.34.0 | Job queue management |

### Security & Authentication

| Technology | Version | Purpose |
|-----------|---------|---------|
| JWT | passport-jwt 4.0.1 | Token-based authentication |
| bcryptjs | 2.4.3 | Password hashing |
| Helmet | 8.0.0 | Security headers |
| Throttler | @nestjs/throttler 6.2.1 | Rate limiting |
| class-validator | 0.14.1 | Input validation |

### Monitoring & Logging

| Technology | Version | Purpose |
|-----------|---------|---------|
| Sentry | @sentry/nestjs 8.45.0 | Error tracking and performance monitoring |
| Pino | nestjs-pino 4.1.0 | Structured logging |
| Terminus | @nestjs/terminus 10.2.3 | Health checks |

### API Documentation

| Technology | Version | Purpose |
|-----------|---------|---------|
| Swagger/OpenAPI | @nestjs/swagger 8.0.7 | API documentation generation |
| swagger-ui-express | 5.0.1 | Interactive API documentation UI |

### Development & Testing

| Technology | Version | Purpose |
|-----------|---------|---------|
| Jest | 29.7.0 | Testing framework |
| Supertest | 7.0.0 | HTTP testing |
| Faker | @faker-js/faker 9.3.0 | Test data generation |
| ts-jest | 29.2.5 | TypeScript Jest support |
| ESLint | 8.57.1 | Code linting |
| Prettier | 3.4.2 | Code formatting |

### Configuration & Environment

| Technology | Version | Purpose |
|-----------|---------|---------|
| @nestjs/config | 3.3.0 | Configuration management |
| Joi | 17.13.3 | Environment validation |
| dotenv | (built-in) | Environment variables |

---

## Component Diagram

```mermaid
graph TB
    subgraph "Application Core"
        APP[AppModule<br/>Root Module]
        
        subgraph "Infrastructure Modules"
            CONFIG[ConfigModule<br/>Environment Config]
            LOGGER[LoggerModule<br/>Pino Logging]
            PRISMA[PrismaModule<br/>Database Client]
            REDIS[RedisModule<br/>Redis Client]
            THROTTLE[ThrottlerModule<br/>Rate Limiting]
        end
        
        subgraph "Feature Modules"
            AUTH[AuthModule<br/>Authentication]
            HEALTH[HealthModule<br/>Health Checks]
            QUEUE[QueueModule<br/>Job Processing]
        end
        
        subgraph "Cross-Cutting Concerns"
            FILTERS[AllExceptionsFilter<br/>Global Error Handler]
            GUARDS[Guards<br/>JwtAuthGuard, RolesGuard]
            PIPES[ValidationPipe<br/>Request Validation]
            SWAGGER[SwaggerModule<br/>API Docs]
            SENTRY_MOD[Sentry<br/>Error Tracking]
        end
    end
    
    subgraph "External Systems"
        DB[(PostgreSQL)]
        REDIS_EXT[(Redis)]
        SENTRY_EXT[Sentry Service]
    end
    
    APP --> CONFIG
    APP --> LOGGER
    APP --> PRISMA
    APP --> REDIS
    APP --> THROTTLE
    APP --> AUTH
    APP --> HEALTH
    APP --> QUEUE
    APP --> SWAGGER
    
    APP -.->|Global| FILTERS
    APP -.->|Global| GUARDS
    APP -.->|Global| PIPES
    
    AUTH --> PRISMA
    AUTH --> GUARDS
    HEALTH --> PRISMA
    HEALTH --> REDIS
    QUEUE --> REDIS
    
    PRISMA --> DB
    REDIS --> REDIS_EXT
    QUEUE --> REDIS_EXT
    FILTERS -.->|Report| SENTRY_MOD
    SENTRY_MOD -.-> SENTRY_EXT
    
    style APP fill:#4A90E2
    style DB fill:#3ECF8E
    style REDIS_EXT fill:#DC382D
    style SENTRY_EXT fill:#362D59
```

### Module Descriptions

#### Core Modules

**AppModule**
- Root application module
- Imports all feature and infrastructure modules
- Configures global providers (filters, guards, pipes)

**ConfigModule**
- Manages environment-specific configuration
- Validates environment variables using Joi schemas
- Provides type-safe configuration access

**LoggerModule**
- Structured logging with Pino
- Automatic sensitive data redaction (passwords, tokens, PII)
- Request/response logging middleware

**PrismaModule**
- Prisma ORM integration
- Database connection pool management
- Health check support

**RedisModule**
- Redis client configuration
- Connection pooling
- Used by BullMQ for job queues

#### Feature Modules

**AuthModule**
- JWT authentication with passport-jwt
- User login and token generation
- Password hashing with bcrypt
- Role-based access control

**HealthModule**
- Health check endpoints (`/health`)
- Database connectivity monitoring
- Redis connectivity monitoring
- Returns HTTP 200 if all healthy, 503 if any dependency fails

**QueueModule**
- Background job processing with BullMQ
- Job processors and queue management
- Used by worker service for async processing

#### Cross-Cutting Concerns

**AllExceptionsFilter**
- Global exception handler
- Standardized error response format
- Automatic Sentry error reporting for 5xx errors
- Structured error logging

**Guards**
- **JwtAuthGuard**: JWT token validation
- **RolesGuard**: Role-based authorization
- Applied globally with `@Public()` decorator for public routes

**ValidationPipe**
- Automatic request body validation
- DTO transformation and type coercion
- Validation error formatting

**ThrottlerModule**
- Rate limiting protection
- Configurable limits per endpoint
- IP-based throttling

**Sentry Integration**
- Automatic error capture
- Performance monitoring (10% sample rate)
- User context and request metadata
- Sensitive data filtering

---

## Data Flow

### Request Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant LB as Load Balancer
    participant MW as Security Middleware
    participant VP as Validation Pipe
    participant AG as Auth Guard
    participant RG as Roles Guard
    participant Ctrl as Controller
    participant Svc as Service
    participant DB as Prisma/PostgreSQL
    participant Log as Logger
    participant Sen as Sentry
    
    Client->>LB: HTTP Request
    LB->>MW: Route Request
    
    MW->>MW: Rate Limit Check
    alt Rate Limit Exceeded
        MW-->>Client: 429 Too Many Requests
    end
    
    MW->>MW: CORS Check
    MW->>MW: Apply Helmet Headers
    
    MW->>VP: Process Request
    VP->>VP: Parse & Validate DTO
    alt Validation Failed
        VP->>Log: Log Validation Error
        VP-->>Client: 400 Bad Request
    end
    
    VP->>AG: Valid Request
    AG->>AG: Verify JWT Token
    alt Auth Failed (not @Public)
        AG->>Log: Log Auth Failure
        AG-->>Client: 401 Unauthorized
    end
    
    AG->>RG: Authenticated Request
    RG->>RG: Check User Roles
    alt Insufficient Permissions
        RG->>Log: Log Authorization Failure
        RG-->>Client: 403 Forbidden
    end
    
    RG->>Ctrl: Authorized Request
    Ctrl->>Svc: Execute Business Logic
    Svc->>DB: Query Database
    DB-->>Svc: Return Data
    Svc-->>Ctrl: Return Result
    
    Ctrl->>Log: Log Success
    Ctrl->>Sen: Record Performance Trace
    Ctrl-->>Client: 200 OK + Response
    
    alt Exception Occurs
        Svc->>Log: Log Error
        Svc->>Sen: Capture Exception
        Svc-->>Client: Error Response (4xx/5xx)
    end
```

### Background Job Processing Flow

```mermaid
sequenceDiagram
    participant API as API Service
    participant Queue as Redis Queue
    participant Worker as Worker Process
    participant DB as PostgreSQL
    participant Log as Logger
    participant Sen as Sentry
    
    API->>Queue: Enqueue Job
    Queue-->>API: Job ID
    API->>Log: Log Job Enqueued
    API-->>API: Continue Processing
    
    loop Poll Queue
        Worker->>Queue: Fetch Next Job
        Queue-->>Worker: Job Data
        
        Worker->>Log: Log Job Started
        Worker->>DB: Execute Job Logic
        DB-->>Worker: Result
        
        alt Job Success
            Worker->>Queue: Mark Complete
            Worker->>Log: Log Job Success
        else Job Failure
            Worker->>Log: Log Job Failure
            Worker->>Sen: Report Error
            Worker->>Queue: Retry or Fail
            alt Max Retries Exceeded
                Queue->>Queue: Mark as Failed
            else Retry Available
                Queue->>Queue: Schedule Retry (1s delay)
            end
        end
    end
```

### Database Connection Pooling

```mermaid
graph LR
    subgraph "Application Instances"
        API1[API Instance 1<br/>Pool: 10 connections]
        API2[API Instance 2<br/>Pool: 10 connections]
        WORKER[Worker<br/>Pool: 10 connections]
    end
    
    subgraph "Supabase"
        PGB[PgBouncer<br/>Transaction Pool]
        PG[(PostgreSQL<br/>Database)]
    end
    
    API1 -->|SSL Connection| PGB
    API2 -->|SSL Connection| PGB
    WORKER -->|SSL Connection| PGB
    
    PGB -->|Connection Reuse| PG
    
    style PGB fill:#3ECF8E
    style PG fill:#336791
```

**Connection Pool Configuration:**
- **Per Service**: Maximum 10 connections
- **Pool Timeout**: 20 seconds
- **Connection Timeout**: 20 seconds
- **Idle Timeout**: 300 seconds (5 minutes)
- **SSL Mode**: Required
- **Prepared Statements**: Cached (100 statements)

---

## Security Architecture

### Security Layers

```mermaid
graph TB
    subgraph "Network Security"
        HTTPS[HTTPS/TLS<br/>Encryption]
        CORS[CORS Policy<br/>Origin Validation]
    end
    
    subgraph "Application Security"
        HELMET[Helmet<br/>Security Headers]
        THROTTLE[Rate Limiting<br/>IP-based]
        PAYLOAD[Payload Size Limit<br/>1MB max]
    end
    
    subgraph "Authentication & Authorization"
        JWT[JWT Tokens<br/>Bearer Auth]
        BCRYPT[bcrypt<br/>Password Hashing]
        GUARDS[Guards<br/>Auth & Roles]
    end
    
    subgraph "Input Validation"
        PIPES[Validation Pipes<br/>class-validator]
        SANITIZE[Data Sanitization<br/>Transform & Strip]
    end
    
    subgraph "Data Protection"
        REDACT[Log Redaction<br/>Sensitive Fields]
        SENTRY_FILTER[Sentry Filters<br/>PII Removal]
    end
    
    REQUEST[HTTP Request] --> HTTPS
    HTTPS --> CORS
    CORS --> HELMET
    HELMET --> THROTTLE
    THROTTLE --> PAYLOAD
    PAYLOAD --> JWT
    JWT --> GUARDS
    GUARDS --> PIPES
    PIPES --> SANITIZE
    SANITIZE --> REDACT
    REDACT --> SENTRY_FILTER
    
    style HTTPS fill:#2ECC71
    style JWT fill:#3498DB
    style REDACT fill:#E74C3C
```

### Security Measures

#### Network Level
1. **TLS/HTTPS**: All communication encrypted in transit
2. **CORS**: Strict origin validation (configurable per environment)
3. **Helmet**: Comprehensive security headers
   - Content Security Policy (CSP)
   - X-Frame-Options (clickjacking protection)
   - X-Content-Type-Options (MIME sniffing protection)
   - Strict-Transport-Security (HSTS)

#### Application Level
1. **Rate Limiting**:
   - General endpoints: 100 requests/minute per IP
   - Authentication endpoints: 5 requests/minute per IP
   - Returns 429 status when exceeded
2. **Payload Size Limits**: 1MB maximum request body size
3. **Input Validation**: Automatic validation using class-validator decorators

#### Authentication & Authorization
1. **JWT Tokens**:
   - Bearer token authentication
   - Configurable expiration (default: 7 days)
   - Signed with secure secret (minimum 32 characters)
2. **Password Security**:
   - bcrypt hashing with automatic salting
   - Password complexity enforced (minimum 8 characters)
3. **Role-Based Access Control (RBAC)**:
   - JwtAuthGuard validates tokens
   - RolesGuard enforces role requirements
   - `@Public()` decorator for public endpoints

#### Data Protection
1. **Logging Redaction**: Automatic removal of sensitive fields
   - password, passwordHash, token
   - bvn, nin (Nigerian PII)
   - Authorization headers
2. **Sentry Filters**: PII and credentials filtered before error reporting
3. **Database Security**:
   - SSL required for all connections
   - Prepared statements prevent SQL injection
   - Connection pooling prevents resource exhaustion

### Security Best Practices

**Environment Variables**:
- All secrets stored in environment variables
- Never committed to version control
- Validated at startup with descriptive error messages

**Database Access**:
- Prisma ORM prevents SQL injection
- Type-safe query building
- Automatic parameterization

**Error Handling**:
- Sensitive information never exposed in error responses
- Stack traces logged but not returned to clients
- Consistent error response format

**Session Management**:
- Stateless JWT tokens (no server-side sessions)
- Token expiration enforced
- No automatic token refresh (explicit re-authentication required)

---

## System Characteristics

### Performance

- **API Response Time**: Target p95 < 200ms for standard requests
- **Database Connection Pool**: Optimized for Supabase PgBouncer
- **Caching**: Redis for frequently accessed data
- **Background Jobs**: Async processing for time-consuming operations

### Scalability

- **Horizontal Scaling**: API service can scale to multiple instances
- **Stateless Design**: No server-side session state
- **Database**: PostgreSQL with connection pooling
- **Queue Processing**: Separate worker service scales independently

### Reliability

- **Health Checks**: Automatic instance health monitoring
- **Graceful Shutdown**: 30-second drain period for in-flight requests
- **Error Recovery**: Automatic job retries with exponential backoff
- **Monitoring**: Real-time error tracking with Sentry

### Maintainability

- **Type Safety**: Full TypeScript coverage
- **Testing**: 80%+ code coverage requirement
- **Documentation**: OpenAPI/Swagger for API documentation
- **Logging**: Structured logging for debugging and auditing
- **Code Quality**: ESLint and Prettier for consistent code style

---

## Related Documentation

- [Authentication & Authorization Flow](./002-authentication-flow.md)
- [Request Lifecycle](./003-request-lifecycle.md)
- [Queue Processing](./004-queue-processing.md)
- [Error Handling](./005-error-handling.md)
- [Deployment Guide](../DEPLOYMENT.md)
