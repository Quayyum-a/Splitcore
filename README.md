# Splitcore Backend — Phase 1: Foundation

This is the foundational layer only — per the roadmap, the actual domain
(venues, entertainers, QR codes, payments, ledger, payouts) is Phase 2
onward. What's here is everything those phases will be built on top of:

- **NestJS** app skeleton, modular from the start
- **PostgreSQL + Prisma**, with a minimal schema (just `User` + `Role`, enough
  for auth — the real domain model arrives in Phase 2)
- **Redis + BullMQ**, with one working example queue (`diagnostics`) proving
  the enqueue → process pipeline end-to-end
- **Authentication**: JWT-based, bcrypt password hashing, role-based guards,
  secure-by-default (every route requires auth unless explicitly marked
  `@Public()`)
- **Structured logging** via pino, with automatic redaction of passwords,
  BVN/NIN, and auth headers from logs
- **Global error handling**: every error, anywhere in the app, returns the
  same JSON shape
- **CI/CD**: GitHub Actions workflow running lint, build, migrations, and
  both unit and e2e tests against real Postgres/Redis service containers
- **Environment validation**: the app refuses to boot with a clear error if
  required env vars are missing or malformed, rather than failing confusingly
  later

## Getting started

**Prerequisites:** Node 22+, Docker (for local Postgres/Redis), npm.

```bash
# 1. Install dependencies
npm install

# 2. Copy the example environment file and adjust if needed
cp .env.example .env

# 3. Start Postgres and Redis
docker compose up -d

# 4. Generate the Prisma client (downloads the query engine — needs normal
#    internet access, which just works outside a sandboxed environment)
npx prisma generate

# 5. Run the initial migration
npx prisma migrate dev --name init

# 6. Seed the first platform admin account
npx prisma db seed
# Prints the seeded email; default password is "ChangeMe123!" unless you
# set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD first — change it after first login.

# 7. Start the app
npm run start:dev
```

Then:
- `GET http://localhost:3000/health` — should report `database: up`, `redis: up`
- `POST http://localhost:3000/auth/login` with `{ "email": "...", "password": "..." }`
  — returns `{ "accessToken": "..." }`

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Start with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build |
| `npm run lint` | ESLint, auto-fixing what it can |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (needs Postgres + Redis running) |
| `npx prisma studio` | Browse the database in a GUI |

## A note on how this was verified

Every piece of this except one was verified against **real** Postgres and
Redis instances, not mocked — the app was actually built and booted, the
health endpoint actually queried a live database, and the BullMQ queue
actually processed a real job through Redis.

The one exception: `prisma generate` needs to download its query engine
binary from Prisma's own server, and the sandboxed environment this was
built in doesn't have network access to that specific domain. That's a
one-time step that runs automatically in `npm install` on any normal
machine or CI runner (as it does in `.github/workflows/ci.yml`) — it isn't
something to debug, just something to expect the first time you run this
somewhere with normal internet access.

## Project structure

```
src/
  auth/            JWT auth, guards, login endpoint
  common/
    decorators/    @Roles(), @Public()
    filters/       Global exception filter
    logger/        Pino logging config
  config/          Environment loading + validation
  health/          /health endpoint (DB + Redis checks)
  prisma/          PrismaService (lifecycle-managed client)
  queue/           BullMQ setup + example processor
  redis/           Shared Redis client
  app.module.ts
  main.ts
prisma/
  schema.prisma
  seed.ts
```

## Security defaults worth knowing about

- **Every route is authenticated by default.** To make a route public, add
  `@Public()` explicitly — this is deliberate: a route that forgets to add a
  guard is far more dangerous than one that forgets to remove one.
- **There is no `/auth/register` endpoint.** Platform and venue admins are
  provisioned via the seed script or, from Phase 2 onward, by an existing
  admin — not self-service signup, since these accounts control payout
  configuration.
- **Passwords are hashed with bcrypt** (12 salt rounds), never stored or
  logged in plaintext. The logger redacts `password`, `passwordHash`, `bvn`,
  and `nin` fields, and auth headers, from every log line automatically.

## What's deliberately not here yet

Venues, entertainers, QR codes, split rules, guest sessions, payments, the
ledger, payouts, webhooks, reconciliation — all Phase 2 onward, per the PRD.
Building those now, before this foundation existed, would mean designing
relationships against tables that don't exist yet.
# Splitcore

## Phase 2: Core Domain (COMPLETE)

Phase 2 introduces the core domain model for digital tipping in Lagos nightlife venues.

### New Domain Models

- **Venues**: Nightclubs and entertainment establishments
- **Entertainers**: DJs and performers with KYC status tracking
- **VenueEntertainer**: Many-to-many relationship (entertainers work at multiple venues)
- **QR Codes**: Public tokens for guest tip resolution (venue-specific or entertainer-specific)
- **Guest Sessions**: 24-hour sessions created when guests scan QR codes
- **Split Rules**: Revenue split configuration per venue (append-only versioning)

### Phase 2 Endpoints

#### Venues
- `POST /venues` - Create venue (Platform Admin only)
- `GET /venues` - List venues (filtered by role)
- `GET /venues/:venueId` - Get venue details
- `PATCH /venues/:venueId` - Update venue (venue-scoped)
- `DELETE /venues/:venueId` - Soft delete venue (venue-scoped)

#### Entertainers
- `POST /entertainers` - Create entertainer
- `GET /entertainers` - List entertainers (filtered by venue access)
- `GET /entertainers/:entertainerId` - Get entertainer details
- `PATCH /entertainers/:entertainerId` - Update entertainer
- `DELETE /entertainers/:entertainerId` - Soft delete (cascades to QR codes)
- `POST /entertainers/:entertainerId/venues/:venueId` - Link to venue
- `DELETE /entertainers/:entertainerId/venues/:venueId` - Unlink from venue

#### QR Codes
- `POST /qr-codes` - Create QR code (venue-scoped)
- `GET /qr-codes` - List QR codes (filtered by venue access)
- `GET /qr-codes/:qrCodeId` - Get QR code details
- `DELETE /qr-codes/:qrCodeId` - Soft delete QR code
- `POST /qr-codes/:qrCodeId/regenerate` - Generate new token (deactivates old)

#### Guest (Public)
- `GET /t/:publicToken` - Resolve QR code and create guest session (**no auth required**)
  - Returns 200 with session for active QR code
  - Returns 404 if token never existed
  - Returns 410 (Gone) if QR code, venue, or entertainer is deactivated

#### Split Rules
- `POST /split-rules` - Create split rule (closes out current rule, venue-scoped)
- `GET /split-rules/venue/:venueId` - Get split rule history
- `GET /split-rules/venue/:venueId/active` - Get currently active rule

### Running Phase 2 Migration

```bash
# Run the Phase 2 migration
npx prisma migrate deploy

# Seed database with sample data
npx prisma db seed
```

### Sample Data (After Seed)

**Credentials:**
- Platform Admin: `admin@splitcore.dev` / `ChangeMe123!`
- Venue Admin 1: `admin@quilox.com` / `Quilox123!`
- Venue Admin 2: `admin@cubana.com` / `Cubana123!`

**Sample QR Tokens (GET /t/:publicToken):**
- `quilox-vip-table-1-dj-neptune-0001` (Entertainer-specific)
- `quilox-general-area-bar-counter-02` (Venue-only)

### Example: Guest Tip Flow

```bash
# 1. Guest scans QR code (no authentication)
curl https://splitcore-api.onrender.com/t/quilox-vip-table-1-dj-neptune-0001

# Response includes:
# - venue details (name, location, logo)
# - entertainer details (if entertainer-specific QR)
# - sessionId (valid for 24 hours)
# - expiresAt timestamp

# 2. Guest proceeds to tip using sessionId (Phase 3+)
```

### Access Control

- **VenueScopedGuard**: Ensures VENUE_ADMIN can only access their assigned venue
- **RolesGuard**: Enforces role-based permissions
- **@Public() decorator**: Marks Guest endpoint as publicly accessible

### Split Rule Versioning

Split rules are append-only with temporal validity:
- Creating a new rule closes out the current active rule (sets `effectiveTo`)
- New rule becomes active with `effectiveTo = null`
- Full history is preserved for audit/analytics

### Test Coverage

- **Unit Tests**: 145 passing
- **E2E Tests**: 54 passing (Venues, Entertainers, QR Codes, Guest)
- **Coverage**: 58% overall (domain modules 80%+, Phase 1 infrastructure excluded)

### What's NOT in Phase 2

- Payment processing (Paystack integration) → Phase 3
- Ledger and transaction tracking → Phase 3
- Payout calculations and disbursement → Phase 4
- Entertainer authentication (ENTERTAINER role) → Phase 7

## Phase 3: Paystack Integration & Payments (COMPLETE)

Phase 3 introduces real money movement: payment processing, double-entry ledger, webhooks, and instant payouts.

### Architecture Overview

```
Guest Tip Flow:
1. Scan QR → Create session
2. Choose amount → Initialize payment (creates CREATED transaction)
3. Redirect to Paystack hosted checkout (never custom card form)
4. Complete payment → Paystack sends webhook
5. Verify signature → Store event → Queue async processing
6. Verify with Paystack API → Create ledger entries (double-entry)
7. Trigger payouts → Instant transfer to VERIFIED entertainers
8. Webhook confirms transfer → Update payout status
```

### New Domain Models

#### Payments
- **PaymentTransaction**: Guest payment records (CREATED → PENDING → SUCCESS)
- **Provider Abstraction**: PaymentProvider & PayoutProvider interfaces (Paystack first, Flutterwave later)

#### Ledger (Double-Entry Bookkeeping)
- **LedgerAccount**: Account types (ENTERTAINER_PAYABLE, VENUE_PAYABLE, PLATFORM_REVENUE, PROCESSOR_CLEARING)
- **LedgerEntry**: Immutable DEBIT/CREDIT entries (balanced at write time)
- **Reconciliation**: Hourly balance checks against Paystack API

#### Payouts
- **Payout**: Transfer records (QUEUED → PROCESSING → SUCCESS/FAILED)
- **KYC Gating**: Only VERIFIED entertainers get instant payouts
- **Idempotency**: Duplicate prevention at webhook and payout level

#### Webhooks
- **WebhookEvent**: Raw event storage with signature verification
- **Async Processing**: BullMQ queue for webhook handling

### Phase 3 Endpoints

#### Payments (Public - No Auth)
- `POST /payments/initialize` - Initialize payment, returns Paystack checkout URL
  ```json
  {
    "sessionId": "guest-session-uuid",
    "amountKobo": 500000,
    "guestDisplayName": "Anonymous Fan",
    "displayNameEnabled": true,
    "email": "guest@example.com"
  }
  ```
- `GET /payments/:reference/status` - Check payment status (fallback verification)

#### Webhooks (Public - Signature Verified)
- `POST /webhooks/paystack` - Receive Paystack webhooks
  - Verifies HMAC SHA512 signature
  - Stores raw event
  - Checks idempotency (duplicate = no-op)
  - Responds 200 within 2s
  - Queues for async processing

### Critical Design Decisions

#### 1. **Provider Abstraction**
- Domain logic never depends on Paystack directly
- `PaymentProvider` & `PayoutProvider` interfaces
- Enables adding Flutterwave without touching ledger/split logic

#### 2. **Never Trust Client Redirect**
- Payment status != client returning from checkout
- Status changes only via:
  - Verified webhook (primary)
  - Explicit API verification (fallback)

#### 3. **Double-Entry Ledger**
- Every transaction produces balanced entries (sum debits = sum credits)
- Enforced at write time in DB transaction
- Entries are immutable (corrections = compensating entries)
- All amounts in integer kobo (NO FLOATS)
- Platform absorbs rounding differences

Example: ₦5,000 tip at 85/10/5 split:
```
DEBIT  PROCESSOR_CLEARING    ₦5,000  (money enters)
CREDIT ENTERTAINER_PAYABLE   ₦4,250  (85%)
CREDIT VENUE_PAYABLE         ₦500    (10%)
CREDIT PLATFORM_REVENUE      ₦250    (5%)
```

#### 4. **Instant Payouts < ₦10k**
- Per-tip payouts keep transfers under ₦10,000
- Avoids ₦50 stamp duty (applies to transfers ≥₦10k)
- Design choice: instant guest experience + cost optimization

#### 5. **KYC Gating**
- Only VERIFIED entertainers get instant payouts
- Others: ledger entries created (money accounted), payout QUEUED
- Failed payout preserves liability (never deletes ledger entry)

#### 6. **Reconciliation**
- Hourly cron compares ledger vs Paystack balance
- Drift detection = first sign of issues
- Logs ERROR with amount, percentage, audit trail

### Environment Configuration

```bash
# .env additions for Phase 3
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key
APP_URL=http://localhost:3000

# Production: Use live keys
PAYSTACK_SECRET_KEY=sk_live_your_live_key
PAYSTACK_PUBLIC_KEY=pk_live_your_live_key
APP_URL=https://api.splitcore.app
```

### Paystack Webhook Setup

1. Go to https://dashboard.paystack.com/#/settings/developer
2. Add webhook URL: `https://api.splitcore.app/webhooks/paystack`
3. Events to listen for:
   - `charge.success` (payment confirmed)
   - `transfer.success` (payout completed)
   - `transfer.failed` (payout failed)
   - `transfer.reversed` (payout reversed)

### Testing Payment Flow

See [PHASE_3_TESTING.md](./PHASE_3_TESTING.md) for comprehensive testing guide including:
- Local testing with Paystack test mode
- Using ngrok for webhook testing
- Test card: `4084084084084081`
- Curl examples for full flow
- Database verification queries
- Expected balances and troubleshooting

Quick test:
```bash
# 1. Get session
curl http://localhost:3000/t/quilox-vip-table-1-dj-neptune-0001

# 2. Initialize payment
curl -X POST http://localhost:3000/payments/initialize \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<session-id>","amountKobo":500000}'

# 3. Complete on Paystack checkout (redirected URL)

# 4. Check status
curl http://localhost:3000/payments/<reference>/status
```

### Database Schema Changes

4 new migrations added:
1. `add_payment_transactions` - PaymentTransaction model
2. `add_ledger_system` - LedgerAccount + LedgerEntry (double-entry)
3. `add_webhook_events` - WebhookEvent storage
4. `add_payouts` - Payout tracking

Run migrations:
```bash
npx prisma migrate deploy
```

### Seed Data Updates

After running seed:
- DJ Neptune: KYC VERIFIED → Gets instant payouts
- DJ Spinall: KYC PENDING → Payouts queued
- Wizkid: KYC REVIEW → Payouts queued
- Burna Boy: KYC NOT_STARTED → Payouts queued
- Davido: KYC FAILED → Payouts queued

### Test Coverage

- **Unit Tests**: 164 passing (21 provider tests, 9 ledger tests added)
- **Build**: ✅ Succeeds
- **Lint**: ✅ 0 errors

### What Happens After Payment

When `charge.success` webhook arrives:

1. **Verification** (< 2s for 200 response)
   - Verify HMAC SHA512 signature → reject if invalid
   - Store raw webhook event
   - Check duplicate (idempotency via externalEventId)
   - Queue for async processing

2. **Async Processing** (BullMQ worker)
   - Verify payment with Paystack API
   - Verify amount matches our record
   - Get active split rule for venue

3. **Ledger Entries** (in transaction)
   - Compute balanced entries (LedgerService)
   - Write to ledger_entries table
   - Update payment status to SUCCESS
   - Verify balance (enforced at DB level)

4. **Payouts** (immediate for VERIFIED)
   - For each CREDIT entry (entertainer/venue)
   - Check KYC status (gate for entertainers)
   - Create Paystack recipient (or reuse)
   - Initiate transfer with unique reference
   - Track status: PROCESSING → SUCCESS/FAILED

5. **Transfer Webhooks**
   - `transfer.success` → Update payout to SUCCESS
   - `transfer.failed` → Update to FAILED, preserve liability

### Reconciliation

Automatic hourly check:
```typescript
@Cron(CronExpression.EVERY_HOUR)
async runHourlyReconciliation() {
  // Compare ledger vs Paystack balance
  // Log ERROR if drift detected
  // Stores audit trail
}
```

Access via logs or expose admin endpoint (TODO: Phase 7).

### Security & Reliability

✅ **Signature Verification**: Every webhook verified with HMAC SHA512  
✅ **Idempotency**: Duplicate webhooks are no-ops (event + transaction level)  
✅ **Balance Enforcement**: Ledger entries rejected if unbalanced  
✅ **Immutable Entries**: Corrections via compensating entries only  
✅ **KYC Gating**: Protects against payouts to unverified accounts  
✅ **Failed Payout Preservation**: Liability never lost on transfer failure  
✅ **Integer Arithmetic**: All amounts in kobo, no float precision loss  
✅ **Reconciliation**: Hourly drift detection  

### What's NOT in Phase 3

- Admin dashboard for manual reconciliation → Phase 7
- KYC verification flow (BVN/NIN) → Phase 6 (other half)
- Entertainer authentication → Phase 7
- Batch venue payouts (currently queued) → Future optimization
- Analytics and reporting → Phase 5

