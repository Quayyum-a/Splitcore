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
