# Requirements Document

## Introduction

Phase 2 builds the core domain model for Splitcore, a Nigerian entertainment payments platform starting with digital tipping in Lagos nightlife. This phase introduces venues (physical locations), entertainers (DJs/performers), their many-to-many relationships, QR codes for tipping, guest sessions created from QR scans, and configurable revenue split rules.

Phase 1 delivered the foundation (NestJS, auth with JWT, Prisma, Redis/BullMQ, logging, error handling, CI/CD). Phase 2 focuses exclusively on domain modeling and CRUD APIs. Payment processing, ledger entries, payouts, and KYC verification flows are deferred to Phase 3+.

## Glossary

- **Platform**: The Splitcore system as a whole
- **Platform_Admin**: User with PLATFORM_ADMIN role, full access to all venues
- **Venue**: A physical entertainment location (club, lounge) where tipping occurs
- **Venue_Admin**: User with VENUE_ADMIN role, scoped to exactly one venue
- **Entertainer**: A DJ, performer, or artist who receives tips
- **QR_Code**: A scannable code linking to a specific venue and optionally an entertainer
- **Public_Token**: An opaque, unguessable string identifier for a QR code (never a database ID)
- **Guest**: An unauthenticated user who scans a QR code to tip
- **Guest_Session**: A temporary session created when a guest scans a QR code
- **Split_Rule**: Revenue split configuration (entertainer/venue/platform shares in basis points)
- **Basis_Points**: Integer representation where 10000 = 100.00% (e.g., 8500 = 85.00%)
- **KYC_Status**: Know Your Customer verification status (PENDING, VERIFIED, REJECTED)
- **Venue_Entertainer**: Many-to-many relationship between venues and entertainers

## Requirements

### Requirement 1: Venue Management

**User Story:** As a Platform Admin, I want to manage venues, so that I can onboard new entertainment locations to the platform.

#### Acceptance Criteria

1. WHEN a Platform_Admin creates a venue with valid details, THE Platform SHALL create a venue record with unique slug
2. WHEN a Platform_Admin creates a venue with a duplicate slug, THE Platform SHALL reject the request with a clear error
3. WHEN a Platform_Admin requests a list of venues, THE Platform SHALL return all venues with pagination support
4. WHEN a Platform_Admin requests a specific venue by ID, THE Platform SHALL return the venue details or 404 if not found
5. WHEN a Platform_Admin updates a venue, THE Platform SHALL update the specified fields and preserve unmodified fields
6. WHEN a Platform_Admin deactivates a venue, THE Platform SHALL set isActive to false without deleting the record
7. WHEN a Venue_Admin attempts venue creation, THE Platform SHALL reject with 403 Forbidden
8. WHEN a Venue_Admin attempts to modify a venue other than their own, THE Platform SHALL reject with 403 Forbidden

### Requirement 2: Entertainer Management

**User Story:** As a Venue Admin, I want to manage entertainers at my venue, so that I can track who performs and receives tips.

#### Acceptance Criteria

1. WHEN an authorized admin creates an entertainer with valid details, THE Platform SHALL create an entertainer record with KYC_Status set to PENDING
2. WHEN an authorized admin creates an entertainer with duplicate phone number, THE Platform SHALL reject the request with a clear error
3. WHEN an authorized admin associates an entertainer with a venue, THE Platform SHALL create a Venue_Entertainer relationship
4. WHEN an authorized admin associates an already-linked entertainer with the same venue, THE Platform SHALL reject with a clear error
5. WHEN an authorized admin removes an entertainer from a venue, THE Platform SHALL delete the Venue_Entertainer relationship without deleting the entertainer record
6. WHEN an authorized admin deactivates an entertainer, THE Platform SHALL set isActive to false and deactivate all associated QR codes
7. WHEN a Venue_Admin attempts to manage entertainers for another venue, THE Platform SHALL reject with 403 Forbidden
8. WHEN a Platform_Admin manages entertainers for any venue, THE Platform SHALL allow the operation

### Requirement 3: QR Code Generation

**User Story:** As a Venue Admin, I want to generate QR codes, so that guests can scan them to tip entertainers.

#### Acceptance Criteria

1. WHEN an authorized admin requests a QR code for a venue and entertainer, THE Platform SHALL generate a unique Public_Token
2. WHEN an authorized admin requests a QR code for a venue without an entertainer, THE Platform SHALL generate a venue-only QR code with null entertainerId
3. WHEN generating a Public_Token, THE Platform SHALL ensure the token is cryptographically random and at least 16 characters long
4. WHEN an authorized admin creates a QR code, THE Platform SHALL store the venue ID, entertainer ID (nullable), location label, and activation status
5. WHEN an authorized admin requests QR codes for their venue, THE Platform SHALL return all QR codes with venue and entertainer details
6. WHEN an authorized admin deactivates a QR code, THE Platform SHALL set isActive to false and record deactivatedAt timestamp
7. WHEN an authorized admin regenerates a QR code, THE Platform SHALL deactivate the old code and create a new code with a new Public_Token
8. WHEN a Venue_Admin attempts to manage QR codes for another venue, THE Platform SHALL reject with 403 Forbidden

### Requirement 4: Guest QR Code Scanning

**User Story:** As a guest, I want to scan a QR code, so that I can access the tipping interface for an entertainer or venue.

#### Acceptance Criteria

1. WHEN a guest scans a valid active QR code, THE Platform SHALL create a Guest_Session with expiration time
2. WHEN a guest scans a valid active QR code, THE Platform SHALL return venue details, entertainer details (if applicable), and location label
3. WHEN a guest scans a deactivated QR code, THE Platform SHALL return 410 Gone with a message indicating the link is no longer active
4. WHEN a guest scans an unknown Public_Token, THE Platform SHALL return 404 Not Found
5. WHEN a guest scans a QR code for a deactivated venue, THE Platform SHALL return 410 Gone with a message indicating the venue is inactive
6. WHEN a guest scans a QR code for a deactivated entertainer, THE Platform SHALL return 410 Gone with a message indicating the entertainer is inactive
7. WHEN creating a Guest_Session, THE Platform SHALL set expiration to 24 hours from creation time
8. THE Platform SHALL allow unauthenticated access to the QR code scanning endpoint

### Requirement 5: Split Rule Management

**User Story:** As a Venue Admin, I want to configure revenue splits, so that tips are distributed correctly between entertainer, venue, and platform.

#### Acceptance Criteria

1. WHEN an authorized admin creates a split rule, THE Platform SHALL validate that entertainerBps + venueBps + platformBps equals exactly 10000
2. WHEN an authorized admin creates a split rule with invalid basis points sum, THE Platform SHALL reject with a clear validation error
3. WHEN an authorized admin creates a new split rule for a venue with an existing active rule, THE Platform SHALL set effectiveTo on the previous rule to the current timestamp
4. WHEN an authorized admin creates a split rule, THE Platform SHALL set effectiveFrom to the current timestamp and effectiveTo to null
5. WHEN an authorized admin requests split rules for a venue, THE Platform SHALL return all rules ordered by effectiveFrom descending
6. WHEN querying the active split rule for a venue, THE Platform SHALL return the rule where effectiveTo is null
7. WHEN a Venue_Admin attempts to manage split rules for another venue, THE Platform SHALL reject with 403 Forbidden
8. WHEN a venue has no active split rule, THE Platform SHALL return 404 Not Found when querying for the active rule

### Requirement 6: Venue-Scoped Access Control

**User Story:** As a Platform Admin, I want to assign Venue Admins to specific venues, so that they can only access their own venue data.

#### Acceptance Criteria

1. WHEN creating a user with VENUE_ADMIN role, THE Platform SHALL require a non-null venueId
2. WHEN creating a user with PLATFORM_ADMIN role, THE Platform SHALL require venueId to be null
3. WHEN a Venue_Admin accesses venue-scoped resources, THE Platform SHALL filter results to only their assigned venue
4. WHEN a Venue_Admin attempts to access another venue's resources, THE Platform SHALL return 403 Forbidden (not 404)
5. WHEN a Platform_Admin accesses venue-scoped resources, THE Platform SHALL allow access to all venues
6. WHEN updating a user's venueId, THE Platform SHALL validate that the venue exists
7. WHEN deactivating a venue, THE Platform SHALL not automatically deactivate associated Venue_Admin users
8. THE Platform SHALL enforce venue-scoped access control via guards or interceptors, not scattered conditional logic

### Requirement 7: Data Validation and Constraints

**User Story:** As a developer, I want strict data validation, so that invalid data never enters the system.

#### Acceptance Criteria

1. WHEN any endpoint receives a request, THE Platform SHALL validate all fields using class-validator decorators
2. WHEN creating or updating monetary values or percentages, THE Platform SHALL reject floating-point numbers and require integers in basis points
3. WHEN creating a venue slug, THE Platform SHALL validate that it contains only lowercase letters, numbers, and hyphens
4. WHEN creating an entertainer with bank details, THE Platform SHALL validate that accountNumber contains only digits
5. WHEN creating a split rule, THE Platform SHALL validate that all basis point fields are non-negative integers
6. WHEN creating a split rule, THE Platform SHALL validate that the sum equals exactly 10000 basis points
7. WHEN validation fails, THE Platform SHALL return 400 Bad Request with detailed field-level error messages
8. THE Platform SHALL apply validation consistently across all domain entities using DTO classes

### Requirement 8: Audit Trail and Immutability

**User Story:** As a Platform Admin, I want historical records preserved, so that I can audit changes and resolve disputes.

#### Acceptance Criteria

1. WHEN deactivating a venue, entertainer, or QR code, THE Platform SHALL set isActive to false without deleting the record
2. WHEN a split rule is superseded, THE Platform SHALL set effectiveTo timestamp without deleting the rule
3. WHEN querying split rule history, THE Platform SHALL return all rules including superseded ones
4. WHEN removing an entertainer from a venue, THE Platform SHALL delete the Venue_Entertainer join record but preserve both entity records
5. WHEN a QR code is regenerated, THE Platform SHALL preserve the old QR code record with deactivatedAt timestamp
6. THE Platform SHALL maintain createdAt and updatedAt timestamps on all domain entities
7. THE Platform SHALL never delete venue, entertainer, or split rule records (only soft delete via isActive flag)
8. THE Platform SHALL allow hard deletion of Venue_Entertainer join records as they represent transient relationships

### Requirement 9: API Documentation

**User Story:** As a frontend developer, I want comprehensive API documentation, so that I can integrate with the backend correctly.

#### Acceptance Criteria

1. WHEN the Platform boots, THE Platform SHALL expose Swagger documentation at /api/docs
2. FOR ALL new endpoints, THE Platform SHALL include Swagger decorators documenting request/response schemas
3. FOR ALL new endpoints, THE Platform SHALL document authentication requirements (@ApiBearerAuth or public)
4. FOR ALL new endpoints, THE Platform SHALL document possible response status codes (200, 400, 403, 404, 410, 500)
5. FOR ALL DTO classes, THE Platform SHALL include @ApiProperty decorators with descriptions and examples
6. FOR ALL enum fields, THE Platform SHALL document possible values in Swagger schemas
7. THE Platform SHALL group endpoints by domain module (Venues, Entertainers, QR Codes, Split Rules) in Swagger UI
8. THE Platform SHALL include example request/response bodies for all endpoints

### Requirement 10: Test Coverage Maintenance

**User Story:** As a developer, I want high test coverage, so that regressions are caught early.

#### Acceptance Criteria

1. FOR ALL new service methods, THE Platform SHALL include unit tests with mocked dependencies
2. FOR ALL new controller endpoints, THE Platform SHALL include e2e tests against real database instances
3. THE Platform SHALL maintain overall test coverage at or above 80 percent
4. FOR ALL access control scenarios, THE Platform SHALL include tests verifying 403 responses for unauthorized access
5. FOR ALL validation rules, THE Platform SHALL include tests for both valid and invalid inputs
6. FOR ALL database constraints, THE Platform SHALL include tests verifying constraint violations are handled
7. FOR ALL QR code scanning scenarios, THE Platform SHALL include tests for active, deactivated, and unknown tokens
8. THE Platform SHALL run all tests in CI pipeline with service containers for Postgres and Redis

## Out of Scope for Phase 2

The following are explicitly deferred to Phase 3 or later:

- **Payment processing**: Paystack integration, payment initialization, webhook handling
- **Ledger entries**: Transaction recording, balance tracking
- **Payout logic**: Bank account verification, payout scheduling, payout execution
- **KYC verification flow**: Document upload, verification service integration (model the KYC_Status enum only)
- **Entertainer authentication**: ENTERTAINER role in JWT, entertainer login endpoints
- **Dashboards**: Venue/entertainer analytics, earnings reports
- **Reconciliation**: Payment matching, dispute resolution
- **Advanced split rules**: Per-entertainer splits within a venue (all splits are venue-level only)

## Design Decisions Requiring Confirmation

### Decision 1: Entertainer Authentication

The PRD mentions entertainers as Phase 2 entities but entertainer login isn't specified until Phase 7 (dashboards). The current requirements treat Entertainer as an entity managed by Venue Admins, without adding an ENTERTAINER role to the JWT authentication system.

**Question:** Should Phase 2 include entertainer login capabilities, or should entertainers remain managed entities until Phase 7?

**Recommended Answer:** Defer entertainer authentication to Phase 7 when dashboards are built. Phase 2 focuses on domain modeling and admin management.

### Decision 2: Split Rule Granularity

The current schema scopes split rules to the venue level (one active rule per venue applies to all entertainers at that venue). Different splits per entertainer within the same venue would require a different schema design (nullable entertainerId on SplitRule, lookup logic changes).

**Question:** Should split rules be venue-level only, or should they support per-entertainer customization within a venue?

**Recommended Answer:** Keep split rules venue-level for Phase 2. Per-entertainer splits can be added in a later phase if business requirements demand it.
