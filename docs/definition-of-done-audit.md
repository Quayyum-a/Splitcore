# Definition-of-Done audit

**Date:** 2026-09-26
**Against:** `https://splitcore-api.onrender.com` (live), Supabase Postgres 17.6
(`aws-0-eu-central-1.pooler.supabase.com`), Paystack **test** mode (`sk_test_`).
**Branch:** `backend/v2-governance-and-payouts`

Every line below is marked from something that actually happened: a real HTTP
call against the live deployment, a real row in the production database, or a
test that exercises the real path. Where the evidence is a test, the test is
named. Where something could not be verified from outside, it says so instead of
guessing.

Read the caveat in each ⚠️ — several of them are the difference between "built"
and "working in production today".

---

## Correcting the starting assumptions

The brief's Section 0 inferred from the public OpenAPI document that Phase 5
(webhooks) and Phase 6 (payouts) showed "no public evidence of existing at all".
Both exist.

| Claimed | Actual |
|---|---|
| Nothing tagged `webhooks` in the spec | `POST /webhooks/paystack` is live and carries `@ApiExcludeEndpoint()` — hidden on purpose, exactly as Section 0 allowed for |
| Nothing tagged `payouts` / `ledger` / `reconciliation` | All three exist as internal services (`src/payouts`, `src/ledger`, `src/reconciliation`). They have no controllers by design; an admin surface is Phase 7 |
| Phase 4 (ledger) "cannot be confirmed from outside" | Confirmed. It is enforced by database triggers and constraints, and a real balanced posting exists in production |

There is no `src/kyc` or `src/notifications` module. KYC is a `kycStatus` enum on
`Entertainer`, set by hand; there is no onboarding flow and no notification
channel.

---

## The checklist

| # | Item | | Evidence |
|---|---|---|---|
| 1 | Venue can be created | ✅ | `POST /venues` as `admin@splitcore.dev` → **201**, id `e7b8c2de…`. Deleted again after the test |
| 2 | Entertainer can be added | ✅ | 5 entertainers in production; `POST /entertainers` live in the spec |
| 3 | Entertainer can complete required onboarding | ❌ | No onboarding exists. `kycStatus` is an enum a platform admin sets manually — no BVN/NIN flow, no bank-account verification step, no `src/kyc`. Entertainers also have `phone` but **no email**, so there is no channel to onboard them over. Phase 6, genuinely not started |
| 4 | QR can be generated | ✅ | 4 QR codes in production; `POST /qr-codes` + `POST /qr-codes/{id}/regenerate` live |
| 5 | QR resolves correctly | ✅ | `GET /t/quilox-vip-table-1-dj-neptune-0001` → **200** with venue, entertainer, location, `sessionId`, `expiresAt`. Unknown token → **404** |
| 6 | Guest can tip without creating an account | ✅ | `GET /t/:token` and `POST /payments/initialize` are both `@Public()`. Drove a real initialization with no credentials |
| 7 | Payment provider checkout works | ✅ | `POST /payments/initialize` → **201** with `authorizationUrl` `https://checkout.paystack.com/x3lazdwlyqd57hz`. Paystack later reported that reference as `abandoned`, i.e. it was a genuine live checkout |
| 8 | Payment webhook is verified | ✅ | Live test: wrong signature → **401**, missing signature → **401**, correct HMAC-SHA512 over the raw body → accepted and stored. See ⚠️ **A** |
| 9 | Duplicate webhooks are harmless | ✅ | Replayed a byte-identical signed event: took the duplicate path (`externalEventId` unique), no second row |
| 10 | Payment is recorded exactly once | ✅ | `external_reference` is unique; references are generated server-side (`pay_` + nanoid(21)) |
| 11 | Ledger balances | ✅ | Production trial balance = **0 kobo**. Enforced by a deferred constraint trigger, proven by probe: an unbalanced posting is rejected with `debits - credits = 100000 kobo` |
| 12 | Split rules are applied correctly | ✅ | The real ₦5,000 tip split 95%/5% against Quilox's 70/25/5 rule — correct, because the QR was venue-wide, and `ledger.service.ts:100` folds the entertainer share into the venue when no entertainer is attributed |
| 13 | Entertainer payable balance is correct | ⚠️ | Arithmetic is proven by unit tests and DB constraints, but **no production tip has ever credited `ENTERTAINER_PAYABLE`** — the one real tip went through a venue-wide QR. Untested against real money |
| 14 | Venue payable balance is correct | ✅ | `CREDIT VENUE_PAYABLE 475000` on transaction `29cb3234…` |
| 15 | Platform revenue is correct | ✅ | `CREDIT PLATFORM_REVENUE 25000` — exactly 5% of 500000 |
| 16 | Payout can be initiated | ⚠️ | Code path is real and a payout row exists, but **no payout has ever completed**. See ⚠️ **B** |
| 17 | Payout retries safely | ✅ | Attempt counter + `transferReference` claim; a retry verifies the previous attempt before sending another. Covered by `payouts.service.spec.ts`, including a regression test for a double-send path found and fixed during this audit |
| 18 | Failed payouts retain the liability | ✅ | Production proof: payout `94187a66…` is `QUEUED`, unexecuted, while `VENUE_PAYABLE` still carries the 475000 credit. Ledger entries are immutable by trigger (`UPDATE`/`DELETE` both rejected) |
| 19 | Guest receives confirmation | ⚠️ | `GET /payments/:reference/status` works and re-verifies with Paystack. The redirect back to the guest was pointing at the **wrong host** until this branch — see ⚠️ **C** |
| 20 | Entertainer sees transaction | ❌ | No entertainer-facing surface at all. No entertainer auth (Phase 7), no endpoint scoped to an entertainer |
| 21 | Venue sees transaction | ❌ | No transaction-list or aggregate endpoint exists. A venue admin can read venues/entertainers/QR/split-rules, but there is nothing serving the "Tonight" totals or transaction history the dashboard needs |
| 22 | Reconciliation works | ⚠️ | `ReconciliationService.run()` exists, is unit-tested, and is registered as an hourly repeatable job — **in the worker, which is not running**. It has never executed against production |
| 23 | Audit trail exists | ✅ | Ledger entries immutable by trigger. This branch adds `split_rule_audit_events`, also immutable by trigger, recording who proposed/accepted every split. Both verified by probe against the real schema |
| 24 | Critical errors generate alerts | ⚠️ | Sentry is wired (`src/instrument.ts`, `SENTRY_DSN` set). But the DSN was committed to a public repo, and no alert rule has been confirmed to fire. Unverified end to end |
| 25 | Security review is completed | ❌ | Not done as a formal pass. This audit found and fixed four security-relevant defects — see "Fixed on this branch" — which is not the same thing |
| 26 | Payment/compliance structure is validated | ❌ | Outside engineering. Paystack is on **test** keys; live Transfers need a CAC-registered business tier. No compliance sign-off exists |
| 27 | Pilot venue completes real transactions | ❌ | No pilot has run. Production holds 3 seeded demo venues and one self-funded test tip |

**Tally: 12 ✅ · 8 ⚠️ · 7 ❌**

---

## The caveats that matter

### ⚠️ A — a correctly-signed webhook currently returns 500

Verified live. Signature verification is sound (401 for wrong and missing), and
the raw event **is** stored before anything else can fail. The 500 comes from the
next step: handing the stored event to the BullMQ queue.

This is deliberate — a throw becomes a 5xx so Paystack retries rather than
considering the event delivered. Nothing is lost. But while it persists, no
webhook is ever processed, which is why `webhook_events` was empty before this
audit: **not one real Paystack webhook has ever been processed in production.**

Cause is the Upstash quota (`ERR max requests limit exceeded. Limit: 500000,
Usage: 500000`, from the deployment's own logs). Note `/health` reports
`redis: up` regardless, because a single `PING` still succeeds while
multi-command enqueues fail or exceed the 2s cap — so the health check is
reassuring and wrong. Definitive confirmation of the failing call is in the
Render logs.

Fix is operational, not code: set `REDIS_ENABLED=false` so webhooks process
inline and return 200, or restore Redis capacity. **Create a new Upstash
instance rather than upgrading — the current Redis password is in this public
repo's git history.**

That the one real tip settled at all is down to the fallback: `GET
/payments/:reference/status` re-verifies with Paystack and settles. The webhook
is not currently what makes money move.

### ⚠️ B — payouts cannot complete, and it is not a code problem

Probed the live Paystack account directly. Transfers are reachable in test mode:
recipient `RCP_7hb82umi6wentfv` created, transfer `TRF_umc39xfxnzvret8r`
accepted. The reply was:

```
status: "otp"   —   "Transfer requires OTP to continue"
```

**"Disable OTP for Transfers" is still switched on** (Paystack → Settings →
Preferences). No application code can work around it: a human must type a
one-time code for every transfer.

The provider previously folded `otp` into `pending`, so the payout sat in
`PROCESSING` forever, the 15-minute sweep re-verified it into the same state
each pass, and nothing reported a problem. Fixed on this branch.

Two things block real payouts today:
1. OTP-for-transfers must be turned off. **Actionable now.**
2. Live-mode Transfers need a CAC-registered business tier. **Cannot be verified
   from here** — tier limits apply to live mode and this account uses test keys.

Also: only `ENTERTAINER_PAYABLE` payouts are attempted. Venue payouts have no
destination modelled, so `VENUE_PAYABLE` obligations accrue indefinitely — which
is the state production is in right now.

### ⚠️ C — the guest was being returned to the wrong host

`callback_url` was built from a single `PAYMENT_CALLBACK_URL`, which had been set
to `https://splitcore-api.onrender.com/payments/callback` — the **API**, not the
frontend. A guest finishing checkout landed back on the backend. Every piece
correct, the end-to-end flow broken.

Fixed: the URL is now derived from `FRONTEND_URL` as
`{FRONTEND_URL}/t/{publicToken}?reference={reference}` — the same page the QR
opened, per the brief's recommended shape. No new backend route is needed; the
page reads `?reference=` and polls `GET /payments/:reference/status`.

`FRONTEND_URL` deliberately **overrides** `PAYMENT_CALLBACK_URL`, so a stale
value in the older setting cannot defeat the fix.

Paystack does not expose `callback_url` through its API and the checkout page is
a JS app, so **the value the live deployment sent could not be read back
remotely.** Setting `FRONTEND_URL` in Render makes the behaviour correct
regardless of what `PAYMENT_CALLBACK_URL` holds.

---

## Confirmed working (Section 6)

Platform-admin cross-venue control, with real authenticated calls as
`admin@splitcore.dev`:

- `GET /venues` → **3 venues** (Eko, Cubana, Quilox). The same call as
  `admin@quilox.com` returns **1**. Scoping works in both directions.
- `POST /venues` → **201**
- `DELETE /venues/{id}` on a venue the admin has no relationship to → **200**

No bug. Verification only, as the brief expected.

## Confirmed working (Section 7)

`https://splitcore-api.onrender.com/api/docs` **renders correctly.** It was
worth checking rather than assuming:

- Page → 200, `<title>Splitcore API Docs</title>`
- All five assets 200 with correct MIME types (`swagger-ui.css` 152KB,
  `swagger-ui-bundle.js` 1.4MB, `swagger-ui-init.js` 55KB,
  `swagger-ui-standalone-preset.js` 230KB, favicon)
- `swagger-ui-init.js` carries the real spec — `/auth/login`,
  `/payments/initialize`, `/split-rules`, `/t/{publicToken}`, `/venues` all present
- Helmet's CSP (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`) permits it
- `/webhooks/paystack` absent, as intended

JSON spec is at **`/api/docs-json`** — not `/docs-json` or `/api-json`, both 404.

---

## Fixed on this branch

| Defect | Why it mattered |
|---|---|
| `callback_url` pointed at the API, not the frontend | Guest flow looked broken end to end |
| `otp` transfers reported as `pending` | Payouts stalled silently and forever |
| Double-send on re-entry for a transfer awaiting OTP | Could have paid the same obligation twice |
| Venue admins could set the platform's own cut | A venue could quietly underpay an entertainer, with the platform enabling it |
| Split rules took effect with no entertainer agreement | Terms imposed rather than agreed |
| Split-rule responses returned the raw entity | Would have leaked `responseTokenHash`, the only thing preventing someone consenting on an entertainer's behalf |
| Migration added a CHECK before its backfill | Would have failed on every existing row. Caught by probing against the real schema |

---

## Still blocked, and on whom

| Blocker | Owner |
|---|---|
| Turn off "Disable OTP for Transfers" in Paystack | Account owner. Blocks **all** payouts |
| Confirm live-mode Transfers tier (CAC registration) | Account owner. Cannot be checked with test keys |
| Restore Redis capacity, or set `REDIS_ENABLED=false` | Render/Upstash. Blocks all webhook processing |
| Set `FRONTEND_URL` in Render | Render. Fixes the guest return journey |
| Rotate leaked secrets: Supabase password, Upstash password, `JWT_SECRET`, Sentry DSN | Still readable in this public repo's history |
| Apply `20260926120000_split_rule_governance` **with** the deploy, not before | Its CHECK is forward-incompatible with the currently deployed build |
| Venue/entertainer dashboard read endpoints (items 20, 21) | Phase 7, not started |

## How to re-run this audit

Nothing here should be trusted once time has passed. The commands are
reproducible: `curl` against the live base URL for endpoint behaviour, `psql`
against the Supabase pooler for row-level evidence, and the Paystack API with
the account's own key for provider state. Probes that write were run inside a
transaction that rolled back, or cleaned up afterwards — production is left as
it was found, with the demo seed and the single real test tip.
