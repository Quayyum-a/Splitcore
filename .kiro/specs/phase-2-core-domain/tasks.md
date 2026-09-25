# Implementation Plan: Phase 2 Core Domain

## Overview

This plan builds the core domain model for Splitcore's entertainment tipping platform. It introduces venues, entertainers, QR codes, guest sessions, and revenue split rules with comprehensive CRUD APIs, access control, and testing.

The implementation follows a bottom-up dependency order: Prisma schema → infrastructure components → domain modules (Venues → Entertainers → QR Codes → Guest → Split Rules) → integration testing.

## Tasks

- [x] 1. Fix TypeScript compilation error in Redis service test
  - Update `src/redis/redis.service.spec.ts` lines 230-231 to properly type the retry strategy callback
  - Ensure `npm run build` succeeds before proceeding with Phase 2 work
  - _Requirements: Pre-existing CI blocker_

- [x] 2. Update Prisma schema with Phase 2 domain models
  - [x] 2.1 Add KycStatus enum and extend User model
    - Add `KycStatus` enum (NOT_STARTED, PENDING, VERIFIED, FAILED, REVIEW, SUSPENDED)
    - Add nullable `venueId` field to User model with foreign key to Venue
    - _Requirements: 6.1, 6.2_
  
  - [x] 2.2 Create Venue and Entertainer models
    - Create `Venue` model (id, name, slug unique, logoUrl nullable, location, isActive, timestamps)
    - Create `Entertainer` model (id, stageName, legalName, phone unique, bankName nullable, accountNumber nullable, kycStatus, isActive, timestamps)
    - Add snake_case @map directives for all fields
    - _Requirements: 1.1, 2.1_
  
  - [x] 2.3 Create VenueEntertainer join table
    - Create `VenueEntertainer` model with composite unique constraint on [venueId, entertainerId]
    - Add cascade delete foreign keys to Venue and Entertainer
    - _Requirements: 2.3, 2.4_
  
  - [x] 2.4 Create QrCode and GuestSession models
    - Create `QrCode` model (id, publicToken unique, venueId, entertainerId nullable, location, isActive, deactivatedAt nullable, timestamps)
    - Create `GuestSession` model (id, qrCodeId, createdAt, expiresAt)
    - _Requirements: 3.1, 3.2, 4.1_
  
  - [x] 2.5 Create SplitRule model with index
    - Create `SplitRule` model (id, venueId, entertainerBps, venueBps, platformBps, effectiveFrom, effectiveTo nullable, timestamps)
    - Add index on [venueId, effectiveFrom] for efficient historical queries
    - _Requirements: 5.1, 5.3_
  
  - [x] 2.6 Generate and run migration
    - Run `npm run prisma:generate` to update Prisma client
    - Run `npm run prisma:migrate:dev -- --name phase-2-core-domain` to create migration
    - Verify migration applies cleanly to fresh database
    - _Requirements: All schema requirements_

- [x] 3. Checkpoint - Ensure schema migration passes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create infrastructure components
  - [x] 4.1 Implement VenueScopedGuard with decorator
    - Create `src/common/guards/venue-scoped.guard.ts`
    - Implement `@VenueScoped()` decorator using SetMetadata
    - Extract venueId from request.params.venueId or request.body.venueId
    - Allow PLATFORM_ADMIN to access any venue
    - Restrict VENUE_ADMIN to user.venueId matches only
    - Return 403 Forbidden for venue scope violations
    - _Requirements: 6.3, 6.4, 6.5, 6.8_
  
  - [x] 4.2 Register VenueScopedGuard in app.module.ts
    - Add VenueScopedGuard as APP_GUARD provider (runs after RolesGuard)
    - Import and register in providers array
    - _Requirements: 6.8_
  
  - [x] 4.3 Create SplitRuleSumValidator custom validator
    - Create `src/split-rules/validators/split-rule-sum.validator.ts`
    - Implement class-validator custom constraint
    - Validate entertainerBps + venueBps + platformBps === 10000
    - Return clear error message with actual sum when validation fails
    - _Requirements: 5.1, 5.2, 7.5, 7.6_
  
  - [x] 4.4 Create QR token generation utility
    - Add `generatePublicToken()` method to QrCodesService
    - Use `crypto.randomBytes(16).toString('hex')` for cryptographically random 32-character tokens
    - _Requirements: 3.3_

- [x] 5. Implement Venues module
  - [x] 5.1 Create module structure and DTOs
    - Generate module with `nest g module venues`
    - Generate service with `nest g service venues --no-spec`
    - Generate controller with `nest g controller venues --no-spec`
    - Create `src/venues/dto/create-venue.dto.ts` with validation decorators (name, slug, logoUrl optional, location)
    - Create `src/venues/dto/update-venue.dto.ts` with partial update fields (name, logoUrl, location, isActive optional)
    - Create `src/venues/dto/venue-response.dto.ts` with @ApiProperty decorators
    - Add slug format validation: @Matches(/^[a-z0-9-]+$/)
    - _Requirements: 1.1, 1.5, 7.1, 7.3, 9.5_
  
  - [x] 5.2 Implement VenuesService with all CRUD methods
    - Inject PrismaService in constructor
    - Implement `create()` - validate unique slug, return created venue
    - Implement `findAll()` - filter by venueId for VENUE_ADMIN, return all for PLATFORM_ADMIN
    - Implement `findOne()` - return venue by ID or throw NotFoundException
    - Implement `update()` - partial update specified fields, preserve others
    - Implement `deactivate()` - set isActive to false without deletion
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 8.1_
  
  - [x] 5.3 Implement VenuesController with all endpoints
    - POST /venues - @Roles('PLATFORM_ADMIN'), CreateVenueDto body
    - GET /venues - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), extract user from request
    - GET /venues/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - PATCH /venues/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - DELETE /venues/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - Add @ApiTags('Venues'), @ApiBearerAuth(), @ApiResponse decorators to all endpoints
    - _Requirements: 1.1-1.8, 9.2, 9.3, 9.4_
  
  - [x] 5.4 Write VenuesService unit tests
    - Mock PrismaService with jest.mock()
    - Test create with valid data returns venue
    - Test create with duplicate slug throws ConflictException
    - Test findAll for PLATFORM_ADMIN returns all venues
    - Test findAll for VENUE_ADMIN returns only their venue
    - Test findOne with valid ID returns venue
    - Test findOne with invalid ID throws NotFoundException
    - Test update preserves unmodified fields
    - Test deactivate sets isActive to false
    - _Requirements: 10.1, 10.2, 10.5_
  
  - [x] 5.5 Write Venues E2E tests
    - Test POST /venues requires PLATFORM_ADMIN role (401 for unauthenticated, 403 for VENUE_ADMIN)
    - Test POST /venues with invalid slug format returns 400
    - Test POST /venues with duplicate slug returns 409
    - Test GET /venues as VENUE_ADMIN returns only their venue
    - Test PATCH /venues/:venueId as VENUE_ADMIN for another venue returns 403
    - Test DELETE /venues/:venueId soft deletes venue (isActive = false)
    - _Requirements: 10.2, 10.4, 10.5, 10.6_

- [x] 6. Implement Entertainers module
  - [x] 6.1 Create module structure and DTOs
    - Generate module, service, controller
    - Create `create-entertainer.dto.ts` (stageName, legalName, phone with E.164 validation, bankName optional, accountNumber optional with digits-only validation)
    - Create `update-entertainer.dto.ts` with partial fields (stageName, legalName, phone, bankName, accountNumber, isActive optional)
    - Create `entertainer-response.dto.ts` with venueIds array
    - Add phone validation: @Matches(/^\+?[1-9]\d{1,14}$/)
    - Add accountNumber validation: @Matches(/^\d+$/)
    - _Requirements: 2.1, 7.1, 7.4, 9.5_
  
  - [x] 6.2 Implement EntertainersService with CRUD and linking methods
    - Implement `create()` - set kycStatus to NOT_STARTED by default
    - Implement `findAll()` - filter by venue access for VENUE_ADMIN
    - Implement `findOne()` - include venueIds array in response
    - Implement `update()` - partial update with validation
    - Implement `deactivate()` - use Prisma transaction to deactivate entertainer and cascade to QR codes
    - Implement `linkToVenue()` - create VenueEntertainer record, reject if already linked
    - Implement `unlinkFromVenue()` - delete VenueEntertainer record, throw NotFoundException if not linked
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 8.1, 8.4_
  
  - [x] 6.3 Implement EntertainersController with all endpoints
    - POST /entertainers - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - GET /entertainers - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - GET /entertainers/:entertainerId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - PATCH /entertainers/:entertainerId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - DELETE /entertainers/:entertainerId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - POST /entertainers/:entertainerId/venues/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - DELETE /entertainers/:entertainerId/venues/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - Add Swagger decorators
    - _Requirements: 2.1-2.8, 9.2, 9.3, 9.4_
  
  - [x] 6.4 Write EntertainersService unit tests
    - Test create sets kycStatus to NOT_STARTED
    - Test create with duplicate phone throws ConflictException
    - Test linkToVenue creates VenueEntertainer record
    - Test linkToVenue with already-linked pair throws ConflictException
    - Test unlinkFromVenue deletes VenueEntertainer record
    - Test unlinkFromVenue with non-linked pair throws NotFoundException
    - Test deactivate cascades to QR codes (transaction)
    - Test findAll for VENUE_ADMIN filters by venue access
    - _Requirements: 10.1, 10.2, 10.5, 10.6_
  
  - [x] 6.5 Write Entertainers E2E tests
    - Test POST /entertainers with invalid phone format returns 400
    - Test POST /entertainers with invalid accountNumber format returns 400
    - Test POST /entertainers/:id/venues/:venueId as VENUE_ADMIN for another venue returns 403
    - Test POST /entertainers/:id/venues/:venueId with already-linked pair returns 409
    - Test DELETE /entertainers/:id/venues/:venueId removes link without deleting entities
    - Test DELETE /entertainers/:id deactivates entertainer and associated QR codes
    - _Requirements: 10.2, 10.4, 10.5, 10.6_

- [x] 7. Checkpoint - Ensure venues and entertainers tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement QR Codes module
  - [x] 8.1 Create module structure and DTOs
    - Generate module, service, controller
    - Create `create-qr-code.dto.ts` (venueId UUID, entertainerId optional UUID, location string)
    - Create `qr-code-response.dto.ts` with nested venue and entertainer details (use VenueResponseDto and EntertainerResponseDto types)
    - _Requirements: 3.1, 3.2, 3.4, 9.5_
  
  - [x] 8.2 Implement QrCodesService with generation and management
    - Implement `create()` - generate publicToken with crypto.randomBytes(16), validate venue and entertainer exist, validate entertainer linked to venue if provided
    - Implement `findAll()` - filter by venue access for VENUE_ADMIN
    - Implement `findOne()` - include venue and entertainer details in response
    - Implement `deactivate()` - set isActive to false and deactivatedAt to current timestamp
    - Implement `regenerate()` - use transaction to deactivate old code and create new code with new publicToken
    - Implement `generatePublicToken()` - return crypto.randomBytes(16).toString('hex')
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  
  - [x] 8.3 Implement QrCodesController with all endpoints
    - POST /qr-codes - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - GET /qr-codes - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - GET /qr-codes/:qrCodeId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - DELETE /qr-codes/:qrCodeId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - POST /qr-codes/:qrCodeId/regenerate - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN')
    - Add Swagger decorators
    - _Requirements: 3.1-3.8, 9.2, 9.3, 9.4_
  
  - [x] 8.4 Write QrCodesService unit tests
    - Test generatePublicToken returns 32-character hex string
    - Test generatePublicToken uniqueness (generate 100 tokens, verify no duplicates)
    - Test create with entertainer validates venue-entertainer link exists
    - Test create without entertainer allows null entertainerId
    - Test deactivate sets isActive to false and deactivatedAt timestamp
    - Test regenerate deactivates old code and creates new code in transaction
    - Test findAll for VENUE_ADMIN filters by venue access
    - _Requirements: 10.1, 10.2, 10.5_
  
  - [x] 8.5 Write QR Codes E2E tests
    - Test POST /qr-codes with non-linked entertainer returns 400
    - Test POST /qr-codes as VENUE_ADMIN for another venue returns 403
    - Test DELETE /qr-codes/:id sets deactivatedAt timestamp
    - Test POST /qr-codes/:id/regenerate creates new token and deactivates old
    - _Requirements: 10.2, 10.4, 10.6_

- [x] 9. Implement Guest module
  - [x] 9.1 Create module structure and DTOs
    - Generate module, service, controller
    - Create `qr-resolution-response.dto.ts` with nested venue (id, name, logoUrl, location) and entertainer (id, stageName) nullable objects, plus location string and expiresAt date
    - _Requirements: 4.2, 9.5_
  
  - [x] 9.2 Implement GuestService with QR resolution
    - Implement `resolveQrCode()` - find QR code by publicToken
    - Throw NotFoundException if publicToken not found
    - Throw GoneException (410) if QR code isActive is false
    - Throw GoneException if venue isActive is false
    - Throw GoneException if entertainer isActive is false (when entertainerId not null)
    - Create GuestSession with expiresAt = now + 24 hours
    - Return venue details, entertainer details (nullable), location, sessionId, expiresAt
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  
  - [x] 9.3 Implement GuestController with public endpoint
    - GET /t/:publicToken - @Public() decorator to allow unauthenticated access
    - Add @ApiTags('Guest'), @ApiResponse decorators
    - Document 200, 404, 410 status codes in Swagger
    - _Requirements: 4.8, 9.2, 9.3, 9.4_
  
  - [x] 9.4 Write GuestService unit tests
    - Test resolveQrCode with valid active QR creates guest session
    - Test resolveQrCode with unknown token throws NotFoundException
    - Test resolveQrCode with deactivated QR code throws GoneException
    - Test resolveQrCode with deactivated venue throws GoneException
    - Test resolveQrCode with deactivated entertainer throws GoneException
    - Test guest session expiresAt is 24 hours from creation
    - _Requirements: 10.1, 10.2, 10.7_
  
  - [x] 9.5 Write Guest E2E tests
    - Test GET /t/:publicToken without JWT token succeeds (public endpoint)
    - Test GET /t/:publicToken with valid active QR returns 200 with venue and entertainer details
    - Test GET /t/:publicToken with deactivated QR returns 410
    - Test GET /t/:publicToken with deactivated venue returns 410
    - Test GET /t/:publicToken with deactivated entertainer returns 410
    - Test GET /t/:publicToken with unknown token returns 404
    - _Requirements: 10.2, 10.7_

- [x] 10. Implement Split Rules module
  - [x] 10.1 Create module structure and DTOs
    - Generate module, service, controller
    - Create `create-split-rule.dto.ts` (venueId UUID, entertainerBps int 0-10000, venueBps int 0-10000, platformBps int 0-10000)
    - Add @Validate(SplitRuleSumValidator) decorator to enforce sum === 10000
    - Create `split-rule-response.dto.ts` with all fields including effectiveFrom and effectiveTo nullable
    - _Requirements: 5.1, 5.2, 7.5, 7.6, 9.5_
  
  - [x] 10.2 Implement SplitRulesService with rule management
    - Implement `create()` - use transaction to set effectiveTo on existing active rule, create new rule with effectiveFrom = now and effectiveTo = null
    - Implement `findAllForVenue()` - return all rules ordered by effectiveFrom DESC
    - Implement `findActiveForVenue()` - return rule where effectiveTo IS NULL, or null if none
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 8.2, 8.3_
  
  - [x] 10.3 Implement SplitRulesController with all endpoints
    - POST /split-rules - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - GET /split-rules/venue/:venueId - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - GET /split-rules/venue/:venueId/active - @Roles('PLATFORM_ADMIN', 'VENUE_ADMIN'), @VenueScoped()
    - Add Swagger decorators
    - _Requirements: 5.1-5.8, 9.2, 9.3, 9.4_
  
  - [x] 10.4 Write SplitRulesService unit tests
    - Test create with valid basis points (sum = 10000) succeeds
    - Test create with invalid sum (not 10000) throws BadRequestException
    - Test create supersedes previous rule (sets effectiveTo on old rule)
    - Test findActiveForVenue returns rule with effectiveTo IS NULL
    - Test findAllForVenue returns rules ordered by effectiveFrom DESC
    - Test findActiveForVenue with no active rule returns null
    - _Requirements: 10.1, 10.2, 10.3, 10.5_
  
  - [x] 10.5 Write Split Rules E2E tests
    - Test POST /split-rules with sum != 10000 returns 400
    - Test POST /split-rules as VENUE_ADMIN for another venue returns 403
    - Test POST /split-rules supersedes existing active rule (old rule gets effectiveTo)
    - Test GET /split-rules/venue/:venueId/active with no rules returns 404
    - Test GET /split-rules/venue/:venueId returns historical rules
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [x] 11. Checkpoint - Ensure all modules and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update seed script with Phase 2 test data
  - Add sample venues (2-3 venues with different locations)
  - Add sample entertainers (4-5 entertainers with varied KYC statuses)
  - Create venue-entertainer links (entertainers linked to multiple venues)
  - Generate sample QR codes (mix of entertainer-specific and venue-only)
  - Create default split rules for each venue (e.g., 65/25/10 split)
  - Ensure seed is idempotent (can run multiple times)
  - _Requirements: All requirements (test data support)_

- [x] 13. Integration testing and validation
  - [x] 13.1 Write cross-module integration E2E tests
    - Test complete venue setup flow: create venue → create entertainer → link to venue → create QR code → scan QR code
    - Test access control flow: VENUE_ADMIN creates entertainer → links to their venue → cannot access another venue's resources
    - Test deactivation cascade: deactivate entertainer → verify QR codes deactivated → verify guest scan returns 410
    - Test split rule history: create initial rule → create second rule → verify first rule has effectiveTo set → query history returns both
    - _Requirements: 10.2, 10.4_
  
  - [x] 13.2 Verify test coverage meets 80% threshold
    - Run `npm run test:cov` to generate coverage report
    - Verify overall coverage >= 80%
    - Verify all new services and controllers covered
    - _Requirements: 10.3_
  
  - [x] 13.3 Run full CI pipeline locally
    - Run `npm run lint` and fix any issues
    - Run `npm run test` to verify all unit tests pass
    - Run `npm run test:e2e` to verify all E2E tests pass
    - Run `npm run build` to verify TypeScript compilation
    - _Requirements: 10.8_

- [x] 14. Documentation and final validation
  - [x] 14.1 Verify Swagger documentation completeness
    - Start dev server and navigate to /api/docs
    - Verify all new endpoints appear under correct tags (Venues, Entertainers, QR Codes, Guest, Split Rules)
    - Verify all endpoints document authentication (@ApiBearerAuth or @Public)
    - Verify all DTOs have example values in Swagger UI
    - Verify all response status codes documented (200, 201, 400, 403, 404, 410, 500)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  
  - [x] 14.2 Update README with Phase 2 setup instructions
    - Document new environment variables (if any)
    - Add Phase 2 migration instructions
    - Update API endpoint list with new routes
    - Add example curl commands for key workflows
    - _Requirements: 9.8_

- [ ] 15. Final checkpoint - Verify Phase 2 complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All monetary values use basis points (integers) to avoid floating-point precision issues
- QR code tokens are cryptographically random (16+ bytes) for security
- Soft deletes preserve audit trail (isActive flags)
- Venue-scoped access control centralized in guard, not scattered in services
- E2E tests run against real database instances via Docker Compose

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.6"] },
    { "id": 4, "tasks": ["4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 7, "tasks": ["4.4", "5.4", "5.5", "6.2", "6.3"] },
    { "id": 8, "tasks": ["6.4", "6.5", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] },
    { "id": 10, "tasks": ["8.4", "8.5", "9.1", "10.1"] },
    { "id": 11, "tasks": ["9.2", "9.3", "10.2", "10.3"] },
    { "id": 12, "tasks": ["9.4", "9.5", "10.4", "10.5"] },
    { "id": 13, "tasks": ["12"] },
    { "id": 14, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 15, "tasks": ["14.1", "14.2"] }
  ]
}
```
