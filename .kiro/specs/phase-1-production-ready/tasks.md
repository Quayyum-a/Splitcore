# Implementation Plan: Phase 1 Production-Ready Backend

## Overview

This implementation plan transforms the Splitcore backend from a working foundation to production-ready status through comprehensive testing infrastructure, security hardening, monitoring integration, deployment automation, and complete documentation. The system uses TypeScript with NestJS framework, PostgreSQL/Prisma, Redis/BullMQ, and deploys to Render with Supabase, Upstash, and Sentry.

## Tasks

### Phase 1: Foundation Setup

- [x] 1. Install required dependencies for testing, security, and monitoring
  - Install @nestjs/throttler for rate limiting
  - Install @nestjs/swagger and swagger-ui-express for API documentation
  - Install @sentry/nestjs and @sentry/profiling-node for monitoring
  - Install @faker-js/faker for test data generation
  - Install @types packages for TypeScript support
  - Update package.json with new scripts for worker and coverage
  - _Requirements: 1.1, 6.2, 7.1, 8.1_

- [x] 2. Configure Jest for comprehensive testing with coverage thresholds
  - Update jest.config.js with coverage thresholds (80% for statements, branches, functions)
  - Configure coverage reporters (json, lcov, text, html)
  - Exclude migrations and configuration files from coverage
  - Create test/jest-e2e.json for E2E test configuration
  - Set test timeout to 30000ms for E2E tests
  - _Requirements: 1.6, 1.7, 20.1, 20.2, 20.3_

### Phase 2: Testing Infrastructure

- [x] 3. Create test utilities and helper functions
  - [x] 3.1 Create test/utils/test-helpers.ts with database setup functions
    - Implement setupTestDatabase() for isolated test database connections
    - Implement cleanupTestDatabase() for truncating tables between tests
    - Implement createTestUser() for creating test users with hashed passwords
    - Implement generateTestToken() with 3600 second validity
    - Implement createAuthenticatedTestContext() for complete auth setup
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_
  
  - [x] 3.2 Create test/utils/test-factories.ts with factory classes
    - Implement UserFactory.create() using faker for realistic data
    - Implement UserFactory.createMany() for bulk user creation
    - Implement JobFactory.create() for queue job creation
    - _Requirements: 1.3, 4.8_
  
  - [x] 3.3 Create test/setup-e2e.ts for E2E test environment
    - Initialize PrismaClient for test database
    - Implement beforeAll hook for connection setup
    - Implement afterAll hook for cleanup
    - Implement beforeEach hook for database truncation (preserving migrations table)
    - _Requirements: 1.5, 1.9_

### Phase 3: Security Hardening

- [x] 4. Implement rate limiting with @nestjs/throttler
  - [x] 4.1 Create throttler configuration module
    - Create src/common/throttler/throttler.config.ts
    - Define default limits (100 requests per 60 seconds)
    - Define auth-specific limits (5 requests per 60 seconds)
    - Export getThrottlerModuleOptions() factory function
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 4.2 Integrate throttler into AppModule
    - Import ThrottlerModule.forRoot() with configuration
    - Add ThrottlerGuard as global APP_GUARD provider
    - Update AuthController with @Throttle decorator for auth endpoints
    - _Requirements: 7.1, 7.2, 7.7_

- [x] 5. Configure CORS and security middleware
  - [x] 5.1 Create CORS configuration
    - Create src/config/cors.config.ts with getCorsOptions()
    - Define environment-specific allowed origins (development, test, production)
    - Configure credentials, methods, allowedHeaders
    - Set maxAge to 86400 (24 hours)
    - _Requirements: 7.4_
  
  - [x] 5.2 Update main.ts with security middleware
    - Configure helmet with Content-Security-Policy, HSTS headers
    - Enable CORS with environment-specific configuration
    - Add payload size limits (1MB for json and urlencoded)
    - Import express json and urlencoded middleware
    - _Requirements: 7.4, 7.5, 7.6, 7.8_

### Phase 4: Monitoring Integration

- [x] 6. Set up Sentry monitoring
  - [x] 6.1 Create Sentry initialization file
    - Create instrument.ts in project root
    - Initialize Sentry with DSN, environment, tracesSampleRate
    - Configure nodeProfilingIntegration and HTTP instrumentation
    - Implement beforeSend hook for sensitive data redaction (password, token, Authorization)
    - Configure ignoreErrors for expected exceptions (401, 403, 404)
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 8.9, 8.11_
  
  - [x] 6.2 Update main.ts to import instrument.ts first
    - Add `import '../instrument'` as first line in main.ts
    - Update package.json start:prod script with --import flag
    - _Requirements: 8.1_
  
  - [x] 6.3 Integrate Sentry into error handling
    - Update AllExceptionsFilter to capture exceptions in Sentry for 5xx errors
    - Add HTTP context (method, url, status_code) to error reports
    - Add user context (userId, role) when available
    - _Requirements: 8.1, 8.4, 8.5, 8.10_

### Phase 5: Environment Management

- [x] 7. Enhance configuration validation
  - [x] 7.1 Update Joi validation schema
    - Update src/config/validation.schema.ts with comprehensive validations
    - Add DATABASE_URL validation with PostgreSQL pattern matching
    - Add REDIS_HOST hostname validation
    - Add REDIS_PORT range validation (1-65535)
    - Add JWT_SECRET minimum length validation (32 characters)
    - Add SENTRY_DSN URI validation
    - Add SENTRY_TRACES_SAMPLE_RATE range validation (0.0-1.0)
    - Add descriptive error messages for each validation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.12_
  
  - [x] 7.2 Update configuration service
    - Update src/config/configuration.ts with sentry configuration
    - Add sentry.dsn and sentry.tracesSampleRate fields
    - Add redis.password optional field
    - Update AppConfig interface with new fields
    - _Requirements: 9.8, 9.9, 9.10, 9.11_
  
  - [x] 7.3 Create production environment example file
    - Create .env.production.example with Supabase DATABASE_URL format
    - Include Upstash Redis configuration placeholders
    - Include Sentry DSN and sample rate configuration
    - Add connection pooling parameters to DATABASE_URL
    - _Requirements: 9.9, 9.10, 9.11_

### Phase 6: Database Connection Pooling

- [x] 8. Configure Prisma for production connection pooling
  - [x] 8.1 Update Prisma schema with metrics preview feature
    - Add `previewFeatures = ["metrics"]` to generator block
    - _Requirements: 10.5_
  
  - [x] 8.2 Enhance PrismaService with connection pool configuration
    - Update src/prisma/prisma.service.ts constructor
    - Add production-specific connection parameters (connection_limit, pool_timeout, connect_timeout)
    - Configure log levels based on environment
    - Add slow query detection (>1000ms) in production
    - Implement ping() method for health checks
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

### Phase 7: API Documentation

- [x] 9. Set up Swagger/OpenAPI documentation
  - [x] 9.1 Create Swagger configuration module
    - Create src/common/swagger/swagger.config.ts
    - Configure DocumentBuilder with title, description, version
    - Add JWT Bearer authentication scheme
    - Add API tags (auth, health)
    - Configure Swagger UI with custom styling
    - Export OpenAPI spec as openapi.json file
    - _Requirements: 6.1, 6.2, 6.6, 6.10_
  
  - [x] 9.2 Update main.ts to setup Swagger
    - Import and call setupSwagger() after app creation
    - Mount Swagger UI at /api/docs endpoint
    - _Requirements: 6.6_
  
  - [x] 9.3 Add Swagger decorators to DTOs and controllers
    - Update LoginDto with @ApiProperty decorators
    - Create LoginResponseDto with @ApiProperty
    - Update AuthController with @ApiTags, @ApiOperation, @ApiResponse
    - Document request/response schemas for all endpoints
    - Add error response examples (400, 401, 403, 404, 500, 429)
    - _Requirements: 6.3, 6.4, 6.5, 6.7, 6.8, 6.9_

### Phase 8: Queue Worker Process

- [x] 10. Create dedicated queue worker process
  - [x] 10.1 Create worker module and entry point
    - Create src/worker/worker.module.ts importing necessary modules
    - Create src/worker.ts as application context entry point
    - Import instrument.ts first for Sentry initialization
    - Initialize Logger and ConfigService
    - Log worker startup with Redis connection details
    - _Requirements: 14.1, 14.2, 14.6, 14.7, 14.10_
  
  - [x] 10.2 Implement graceful shutdown handling
    - Register SIGTERM and SIGINT signal handlers
    - Wait maximum 30 seconds for job completion on shutdown
    - Close application context cleanly
    - Log shutdown events
    - _Requirements: 14.8, 14.9_
  
  - [x] 10.3 Enhance Redis service with retry logic
    - Update src/redis/redis.service.ts with connection retry strategy
    - Configure 10 second connection timeout
    - Implement 5 second reconnection interval
    - Set maximum 12 reconnection attempts (60 seconds total)
    - Exit process with error code after max attempts exceeded
    - Add connection event logging (connect, error, close)
    - Implement isReady() status check method
    - _Requirements: 14.3, 14.4, 14.5, 14.10_
  
  - [x] 10.4 Add worker npm scripts
    - Add start:worker script for development (ts-node)
    - Add start:worker:dev script with nodemon
    - Add start:worker:prod script with instrument import
    - _Requirements: 14.1_

### Phase 9: Deployment Configuration

- [x] 11. Create Render deployment configuration
  - [x] 11.1 Create render.yaml blueprint
    - Define web service for API with health check endpoint
    - Define worker service for queue processing
    - Configure build commands (npm ci, prisma generate, npm run build)
    - Configure start commands for API and worker
    - Set autoDeploy from main branch
    - Set region to oregon
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.11, 11.12, 11.13_
  
  - [x] 11.2 Configure environment variables in render.yaml
    - Add DATABASE_URL as sync:false (set in dashboard)
    - Add REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
    - Add JWT_SECRET with generateValue:true option
    - Add SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE
    - Add NODE_ENV=production, PORT=3000, LOG_LEVEL=info
    - Ensure worker service environment matches API service
    - _Requirements: 11.6, 11.7, 11.8, 11.9, 11.10_

### Phase 10: Comprehensive Testing

- [x] 12. Write unit tests for authentication system
  - [x]* 12.1 Create auth.service.spec.ts
    - Test validateUser() with valid credentials
    - Test validateUser() with incorrect password (expect 401)
    - Test validateUser() with non-existent email (expect 401)
    - Test login() generates valid JWT with correct claims
    - Test password hashing round-trip property
    - Test unique salt generation per password
    - Verify 80%+ code coverage for auth module
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.10, 2.11, 2.12_
  
  - [x]* 12.2 Create jwt-auth.guard.spec.ts
    - Test canActivate() with valid JWT token
    - Test canActivate() with invalid JWT token (expect 401)
    - Test canActivate() with expired JWT token (expect 401)
    - Test canActivate() bypasses check for @Public() routes
    - Test user context extraction from token (userId, role)
    - _Requirements: 2.4, 2.5, 2.6, 2.7_
  
  - [x]* 12.3 Create roles.guard.spec.ts
    - Test canActivate() with matching role
    - Test canActivate() with mismatched role (expect 403)
    - Test canActivate() bypasses check when no @Roles() decorator present
    - _Requirements: 2.8, 2.9_

- [x] 13. Write unit tests for health check system
  - [x]* 13.1 Create health.controller.spec.ts
    - Test health endpoint returns 200 when database is available
    - Test health endpoint returns 503 when database is unavailable
    - Test health endpoint returns 200 when Redis is available
    - Test health endpoint returns 503 when Redis is unavailable
    - Test health endpoint returns database status "up"/"down"
    - Test health endpoint returns Redis status "up"/"down"
    - Test response includes "status", "database", and "redis" fields
    - Test health checks complete within 5 seconds
    - Verify 80%+ code coverage for health module
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 14. Write unit tests for queue processing
  - [x]* 14.1 Create queue.service.spec.ts
    - Test job enqueue successfully adds job to queue
    - Test job processing starts within 5 seconds
    - Test job completes within 30 seconds maximum
    - Test job retry on failure with 1 second delay
    - Test job marked as failed after max retries exceeded
    - Test completed job removed from queue
    - Test job data integrity throughout enqueue-process cycle
    - Verify 80%+ code coverage for queue module
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 15. Write unit tests for error handling
  - [x]* 15.1 Create all-exceptions.filter.spec.ts
    - Test filter returns 500 for unhandled exceptions
    - Test filter returns structured JSON error response
    - Test filter returns 400 with validation details
    - Test filter returns 401 for authentication errors
    - Test filter returns 403 for authorization errors
    - Test filter returns 404 for not found errors
    - Test error response includes timestamp, path, statusCode, error, message
    - Test filter logs errors with appropriate severity
    - Verify 80%+ code coverage for error filters
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [x] 16. Write unit tests for configuration and parsing
  - [x]* 16.1 Create validation.schema.spec.ts
    - Test schema rejects missing DATABASE_URL with exit code 1
    - Test schema rejects missing REDIS_HOST with exit code 1
    - Test schema rejects missing JWT_SECRET with exit code 1
    - Test schema rejects invalid DATABASE_URL format
    - Test schema rejects invalid REDIS_HOST format
    - Test schema rejects PORT outside range 1-65535
    - Test schema rejects JWT_SECRET shorter than 32 characters
    - Test schema outputs descriptive error messages
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13_
  
  - [x]* 16.2 Create jwt parsing unit tests
    - Test JWT parser extracts userId and role from valid token
    - Test JWT parser rejects malformed token with 401
    - Test JWT parser rejects invalid signature with 401
    - Test JWT parser rejects expired token with 401
    - Test JWT round-trip property (generate then parse extracts original data)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_
  
  - [x]* 16.3 Create request validation unit tests
    - Test ValidationPipe rejects missing required fields with 400
    - Test ValidationPipe rejects incorrect field types with 400
    - Test ValidationPipe returns all validation errors in single response
    - Test ValidationPipe strips unknown properties
    - Test ValidationPipe transforms types with @Type decorators
    - Test ValidationPipe validates nested objects recursively
    - Test ValidationPipe enforces max nesting depth of 10 levels
    - Test validation completes within 5 seconds
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_

- [x] 17. Write unit tests for logging sanitization
  - [x]* 17.1 Create logger redaction unit tests
    - Test Logger redacts "password" field (case-insensitive)
    - Test Logger redacts "passwordHash" field (case-insensitive)
    - Test Logger redacts "token" field (case-insensitive)
    - Test Logger redacts "bvn" field (case-insensitive)
    - Test Logger redacts "nin" field (case-insensitive)
    - Test Logger redacts Authorization headers in HTTP requests
    - Test Logger replaces redacted values with "[REDACTED]"
    - Test Logger traverses and redacts nested objects
    - Test Logger traverses and redacts array elements
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9_

- [ ] 18. Write unit tests for Prisma query operations
  - [ ]* 18.1 Create prisma round-trip tests
    - Test creating then retrieving User returns equivalent data
    - Test Prisma Client generation from schema
    - Test Prisma validates query structure before execution
    - Test invalid query rejected with descriptive error
    - _Requirements: 15.1, 15.3, 15.4, 15.7_

- [x] 19. Checkpoint - Verify unit test coverage meets 80% threshold
  - Run `npm run test:cov` to generate coverage report
  - Verify statement coverage >= 80%
  - Verify branch coverage >= 80%
  - Verify function coverage >= 80%
  - Review HTML coverage report for uncovered code
  - Address any coverage gaps in critical modules
  - _Requirements: 20.1, 20.2, 20.3, 20.7, 20.8_

- [x] 20. Write E2E tests for authentication flows
  - [x]* 20.1 Create test/auth.e2e-spec.ts
    - Test POST /auth/login with valid credentials returns 200 and token
    - Test POST /auth/login with invalid credentials returns 401
    - Test POST /auth/login enforces rate limiting (5 requests per 60 seconds)
    - Test 6th request within window returns 429
    - Test protected endpoint access with valid token returns 200
    - Test protected endpoint access without token returns 401
    - Test protected endpoint access with expired token returns 401
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 7.2, 7.7_

- [x] 21. Write E2E tests for health check endpoints
  - [x]* 21.1 Create test/health.e2e-spec.ts
    - Test GET /health returns 200 when all dependencies healthy
    - Test GET /health response includes database status "up"
    - Test GET /health response includes Redis status "up"
    - Test GET /health returns 503 when database is down
    - Test GET /health returns 503 when Redis is down
    - _Requirements: 3.1, 3.3, 3.5, 3.6_

- [x] 22. Write E2E tests for queue processing
  - [x]* 22.1 Create test/queue.e2e-spec.ts
    - Test job enqueue and successful processing
    - Test job completes within expected timeframe
    - Test failed job retries with configured delay
    - Test job marked as failed after max retries
    - Test job data integrity throughout lifecycle
    - _Requirements: 4.1, 4.2, 4.4, 4.6, 4.8_

- [x] 23. Write E2E tests for security middleware
  - [x]* 23.1 Create test/security.e2e-spec.ts
    - Test rate limiting returns 429 when limit exceeded
    - Test CORS rejects requests from unauthorized origins
    - Test payload size limit returns 413 when exceeded
    - Test security headers present in responses (helmet)
    - _Requirements: 7.3, 7.4, 7.6, 7.7, 7.8_

- [x] 24. Write E2E tests for error handling
  - [x]* 24.1 Create test/error-handling.e2e-spec.ts
    - Test unhandled exception returns 500 with structured response
    - Test validation error returns 400 with field details
    - Test authentication error returns 401
    - Test authorization error returns 403
    - Test not found returns 404
    - Test error response structure matches specification
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 25. Checkpoint - Run all tests and verify CI pipeline
  - Run `npm test` to execute all unit tests
  - Run `npm run test:e2e` to execute all E2E tests
  - Run `npm run test:cov` to verify final coverage >= 80%
  - Fix any failing tests
  - Ensure CI pipeline passes with coverage checks
  - _Requirements: 20.4, 20.5, 20.6_

### Phase 11: Documentation

- [ ] 26. Write architecture documentation
  - [x] 26.1 Create system overview documentation
    - Create docs/architecture/001-system-overview.md
    - Document overall architecture with component diagram
    - Document deployment architecture
    - Document technology stack
    - _Requirements: 13.1, 13.2, 13.3_
  
  - [x] 26.2 Create module relationships documentation
    - Create docs/architecture/002-module-architecture.md
    - Document module dependencies with diagram
    - Document module responsibilities
    - Document shared infrastructure (Prisma, Redis, Logger)
    - _Requirements: 13.1, 13.4_
  
  - [x] 26.3 Create authentication flow documentation
    - Create docs/architecture/003-authentication-flow.md
    - Document JWT token structure and validation
    - Create sequence diagram for authentication
    - Document role-based access control
    - Document @Public() decorator usage
    - _Requirements: 13.1, 13.5_
  
  - [ ] 26.4 Create request lifecycle documentation
    - Create docs/architecture/004-request-lifecycle.md
    - Document request flow from HTTP to response
    - Create sequence diagram showing all middleware layers
    - Document guard execution order
    - _Requirements: 13.1, 13.6_
  
  - [ ] 26.5 Create queue processing documentation
    - Create docs/architecture/005-queue-processing.md
    - Document job lifecycle with state diagram
    - Document retry strategies
    - Document worker process architecture
    - _Requirements: 13.1, 13.7_
  
  - [ ] 26.6 Create error handling documentation
    - Create docs/architecture/006-error-handling.md
    - Document error flow with diagram
    - Document error response format
    - Document Sentry integration
    - _Requirements: 13.1, 13.8_
  
  - [ ] 26.7 Create logging strategy documentation
    - Create docs/architecture/007-logging-strategy.md
    - Document logging levels and usage
    - Document sensitive data redaction rules
    - Document structured logging format
    - _Requirements: 13.1, 13.9_
  
  - [ ] 26.8 Create database schema documentation
    - Create docs/architecture/008-database-design.md
    - Document database schema with entity relationships
    - Document data transformation rules
    - Document connection pooling configuration
    - _Requirements: 13.1, 13.10_

- [ ] 27. Write deployment documentation
  - [x] 27.1 Create infrastructure setup guide
    - Create docs/deployment/001-infrastructure-setup.md
    - Document Supabase database setup with step-by-step instructions
    - Include verification criteria for successful setup
    - Document Upstash Redis setup with step-by-step instructions
    - Include verification criteria for Redis setup
    - Document Sentry project setup with step-by-step instructions
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [x] 27.2 Create Render deployment guide
    - Create docs/deployment/002-render-deployment.md
    - Document Render service creation process with step-by-step instructions
    - Document environment variable configuration for all required variables
    - Document health check verification
    - Include screenshots or CLI examples where helpful
    - _Requirements: 12.6, 12.7_
  
  - [ ] 27.3 Create database migration guide
    - Create docs/deployment/003-database-migrations.md
    - Document migration execution process
    - Document admin user seeding process
    - Include rollback procedures
    - _Requirements: 12.8, 12.9_
  
  - [ ] 27.4 Create troubleshooting guide
    - Create docs/deployment/004-troubleshooting.md
    - Document common deployment failures with solutions
    - Document connection issues (database, Redis)
    - Document worker process issues
    - Document rate limiting issues
    - Document monitoring and key metrics
    - Document rollback procedures
    - _Requirements: 12.10_

- [x] 28. Generate API documentation
  - Verify Swagger UI accessible at /api/docs
  - Verify OpenAPI spec exported as openapi.json
  - Test interactive API documentation with example requests
  - Verify all endpoints documented with request/response schemas
  - Verify authentication requirements documented
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.10_

### Phase 12: Final Verification

- [ ] 29. Verify all requirements are met
  - Review requirements document and check off each acceptance criterion
  - Run full test suite with coverage report
  - Verify all documentation is complete and accurate
  - Test deployment configuration locally with Docker
  - Verify Sentry integration captures errors correctly
  - Verify rate limiting works as expected
  - Verify API documentation is comprehensive
  - _Requirements: All_

- [ ] 30. Final checkpoint - Production readiness checklist
  - [x] 30.1 Verify all tests passing (unit + E2E)
    - _Requirements: 20.4, 20.5_
  
  - [x] 30.2 Verify code coverage >= 80%
    - _Requirements: 20.1, 20.2, 20.3_
  
  - [x] 30.3 Verify security middleware configured (rate limiting, CORS, helmet)
    - _Requirements: 7.1, 7.4, 7.5_
  
  - [x] 30.4 Verify monitoring integrated (Sentry with error capture)
    - _Requirements: 8.1, 8.4_
  
  - [x] 30.5 Verify environment validation working
    - _Requirements: 9.1, 9.2, 9.3_
  
  - [x] 30.6 Verify database connection pooling configured
    - _Requirements: 10.1, 10.2_
  
  - [x] 30.7 Verify API documentation generated and accessible
    - _Requirements: 6.1, 6.6_
  
  - [x] 30.8 Verify worker process configured with graceful shutdown
    - _Requirements: 14.8, 14.9_
  
  - [x] 30.9 Verify deployment configuration complete (render.yaml)
    - _Requirements: 11.1, 11.2_
  
  - [ ] 30.10 Verify architecture documentation complete
    - _Requirements: 13.1_
  
  - [ ] 30.11 Verify deployment guide complete
    - _Requirements: 12.1, 12.6_
  
  - [ ] 30.12 Verify troubleshooting guide complete
    - _Requirements: 12.10_

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for faster MVP, though not recommended given the critical nature of production readiness
- Each task references specific requirements for traceability
- Checkpoints (tasks 19, 25, 29, 30) ensure incremental validation
- Test tasks are designed to verify acceptance criteria from requirements document
- Unit tests and E2E tests are complementary and both contribute to 80% coverage goal
- Phase 1-9 focus on implementation, Phase 10 on testing, Phase 11 on documentation, Phase 12 on verification
- The design document specifies that property-based testing is not applicable for this feature (infrastructure configuration)
- Testing approach uses unit tests for specific cases and E2E tests for integration scenarios

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "7.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1", "7.2", "8.1"] },
    { "id": 3, "tasks": ["4.2", "5.1", "7.3", "8.2", "9.1", "10.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "9.2", "10.2", "10.3"] },
    { "id": 5, "tasks": ["6.2", "6.3", "9.3", "10.4", "11.1"] },
    { "id": 6, "tasks": ["11.2", "12.1", "12.2", "12.3", "13.1", "14.1", "15.1", "16.1", "16.2", "16.3", "17.1", "18.1"] },
    { "id": 7, "tasks": ["19.1"] },
    { "id": 8, "tasks": ["20.1", "21.1", "22.1", "23.1", "24.1"] },
    { "id": 9, "tasks": ["25.1"] },
    { "id": 10, "tasks": ["26.1", "26.2", "26.3", "26.4", "26.5", "26.6", "26.7", "26.8", "27.1", "27.2", "27.3", "27.4"] },
    { "id": 11, "tasks": ["28.1"] },
    { "id": 12, "tasks": ["29.1", "30.1", "30.2", "30.3", "30.4", "30.5", "30.6", "30.7", "30.8", "30.9", "30.10", "30.11", "30.12"] }
  ]
}
```
