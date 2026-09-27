# API contract — Splitcore backend

**Date:** 2026-09-26 · **Branch:** `backend/phase6-kyc-phase7-dashboards`
**Base URL:** `https://splitcore-api.onrender.com` · **Swagger UI:** `/api/docs` · **Spec JSON:** `/api/docs-json`

This is the shape the round-3 frontend can build against. Endpoints added on this
branch are marked **NEW** and are **not on the live deployment until this merges**
— check `/api/docs-json` before relying on them.

Money is **always integer kobo**. Never do float arithmetic on it; format at the
edge only. `₦5,000` is `500000`.

---

## Authentication

Three roles. `PLATFORM_ADMIN` and `VENUE_ADMIN` sign in with a password;
`ENTERTAINER` has no password and signs in with a one-time link.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /auth/login` | public | `{email, password}` → `{accessToken}`. JWT carries `sub`, `email`, `role` — **no `venueId`**, and there is no `/auth/me`. A venue admin discovers their venue from `GET /venues`, which returns exactly one for them |
| `POST /entertainer-auth/login-links/:entertainerId` **NEW** | `PLATFORM_ADMIN`, `VENUE_ADMIN` | → `{loginUrl, token, expiresAt}`. Single use, 30 min. A venue admin may only do this for entertainers at their own venue |
| `POST /entertainer-auth/sessions` **NEW** | public | `{token}` → `{accessToken, entertainerId, stageName}`. 12-hour `ENTERTAINER` JWT. Unknown, expired and already-used tokens all answer the same 401 |

**No notification channel exists.** Entertainers have a phone number but no
email, and there is no notifications module, so `loginUrl` is returned to the
caller for the dashboard to deliver by hand. Same for split-rule consent links.
Shown once — only a hash is stored.

---

## Guest tipping (unchanged, live)

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /t/:publicToken` | public | → `{venue{id,name,logoUrl,location}, entertainer{id,stageName}\|null, location, sessionId, expiresAt}`. 404 unknown token, 410 deactivated |
| `POST /payments/initialize` | public | `{sessionId, amountKobo, email?, guestDisplayName?, displayNameEnabled?}` → `{transactionId, reference, authorizationUrl, accessCode, amountKobo, status}`. **Redirect to `authorizationUrl`** — it is a hosted Paystack checkout, so use the redirect flow, not Inline |
| `GET /payments/:reference/status` | public | The real source of truth. Re-verifies with Paystack and settles. Poll this after the guest returns |

`callback_url` is set server-side to `{FRONTEND_URL}/t/{publicToken}?reference={reference}`
— the guest comes back to the page the QR opened. Read `?reference=` on load and
poll the status endpoint. **The redirect proves nothing**; only the status call does.

Statuses: `CREATED`, `PENDING`, `SUCCESS`, `FAILED`, `ABANDONED`, `REVERSED`,
`REFUNDED`. Render `PENDING` as "confirming…", never as success or failure.

---

---

## Banks — **NEW**

```
GET /banks    → [{ name, code }]
```

Authenticated (any role). Not because the list is secret — Paystack's is public —
but because an unauthenticated endpoint that proxies a third party is a free
egress and cache-fill vector pointed at someone else's API, and nothing needs it
before login: every caller that picks a bank already holds a session.

The provider's own list, **cached 24h**, filtered to banks that are `active` and
`supports_transfer` (offering one that can't receive a transfer only moves the
failure later), sorted by name. ~263 usable banks for NGN.

**Use the `code`, not the name.** Names are messy: Paystack calls them
`Guaranty Trust Bank`, `United Bank For Africa`, `First City Monument Bank` —
nobody types those. `bankName` is accepted and resolved, including an alias layer
for the colloquial forms (GTBank, UBA, FCMB, First Bank), but an ambiguous name
is a **400 listing the candidates** rather than a guess: "First Bank" and
"First Bank MFB" are different destinations.

## Entertainer KYC — **NEW**, the five-step flow

All under `/entertainers/:entertainerId/kyc`. Every response is the same
`KycStatus` object, so a client can drive the whole flow from one shape.

**Who may call what — this asymmetry is deliberate, not an oversight:**

| Step | Who |
|---|---|
| `status`, `bank-details`, `resolve-account` | `PLATFORM_ADMIN`, `VENUE_ADMIN` (own venue), `ENTERTAINER` (self) |
| **`confirm-account`** | **`ENTERTAINER` only** |
| **`verify-identity`** | **`ENTERTAINER` only** |
| `review` | `PLATFORM_ADMIN` only |

Capturing and resolving bank details asserts nothing *about* the entertainer —
`resolve-account` only asks the bank a question — so admin-assisted bootstrapping
is a genuine convenience. Everything that makes a claim about the entertainer is
theirs alone. `confirm-account` previously allowed `VENUE_ADMIN`, which meant a
venue admin could submit, resolve and self-confirm a bank account for any
entertainer at their venue and the record was indistinguishable from the
entertainer doing it. There is no admin override: if an entertainer can't reach
the link, issue them a login link rather than confirming for them.

**Frontend consequence:** the confirm and identity steps require an
`ENTERTAINER` session from `POST /entertainer-auth/sessions`. A venue-admin
onboarding screen can get someone to step 2 but cannot finish it.

```
GET  /status            → current state + nextStep
POST /bank-details      {accountNumber, bankCode | bankName}  → step 1
POST /resolve-account   (no body)                             → step 2
POST /confirm-account   {confirmedAccountName}                → step 3
POST /verify-identity   {documentType: 'BVN'|'NIN', documentNumber}  → step 4
POST /review            {decision: 'APPROVE'|'REJECT', reason}  → PLATFORM_ADMIN only
```

Response shape:

```json
{
  "entertainerId": "uuid",
  "status": "NOT_STARTED|PENDING|VERIFIED|FAILED|REVIEW|SUSPENDED",
  "nextStep": "BANK_DETAILS|RESOLVE_ACCOUNT|CONFIRM_ACCOUNT|VERIFY_IDENTITY|DONE",
  "bankName": "GTBank",
  "bankCode": "058",
  "accountNumberMasked": "******6789",
  "resolvedAccountName": "PATRICK IMOHIOSEN",
  "accountConfirmedAt": "2026-09-26T12:00:00Z",
  "identityCheckType": "BVN",
  "identityCheckedAt": null,
  "failureReason": null,
  "payoutsEnabled": false
}
```

**Drive the UI from `nextStep`** — don't re-derive it.

Behaviour the UI must respect:

- After `resolve-account`, show `resolvedAccountName` and ask "is this you?".
  `confirm-account` must echo that exact name back; anything else is a 400.
- Changing the account number **resets** resolution, confirmation and
  verification. Warn before letting someone edit a confirmed account.
- `verify-identity` will currently return **`status: "REVIEW"`** with
  `failureReason` explaining that identity verification is not enabled on the
  Paystack account (it needs the CAC-registered tier). This is expected, not a
  bug. Show it as "awaiting manual review", **not** as a failure.
- `payoutsEnabled` is the single flag worth showing next to "can get paid". It
  requires `VERIFIED` **and** a confirmed account.
- `documentNumber` is sent once and never stored or returned. Do not cache it.
- `bankCode` must come from the provider's bank list, not typed. There is no
  bank-list endpoint yet — see "Gaps" below.

---

## Venue dashboard — **NEW**

`PLATFORM_ADMIN` and `VENUE_ADMIN` (own venue).

```
GET /venues/:venueId/overview
GET /venues/:venueId/entertainer-earnings
GET /venues/:venueId/transactions?limit=&offset=
GET /venues/:venueId/payouts?limit=&offset=
```

`overview` →

```json
{
  "venueId": "uuid", "venueName": "Quilox Nightclub",
  "windowFrom": "2026-09-25T23:00:00.000Z",
  "windowTo": "2026-09-26T09:15:00.000Z",
  "totalTipsKobo": 53750000,
  "transactionCount": 183,
  "entertainerCount": 7,
  "pendingPayoutsKobo": 2100000
}
```

Maps to the spec's tiles: Total Tips / Transactions / Entertainers / Pending Payouts.

- **"Tonight" = the Africa/Lagos calendar day, midnight to now.** Nigeria is
  UTC+1 with no DST, so `windowFrom` is 23:00 UTC the previous day. Midnight, not
  a 6am nightlife boundary, so the figures agree with the venue's bank.
- `totalTipsKobo` is **gross takings** and counts `SUCCESS` only.
- `pendingPayoutsKobo` is a **balance as it stands now** (`QUEUED`, `RETRYING`,
  `PROCESSING`), not a figure for the window. Label it accordingly.
- `entertainer-earnings` → array of `{entertainerId, stageName, tonightKobo, thisWeekKobo, totalKobo}`,
  each entertainer's **own share** from the ledger, counting only this venue.
  "This week" is a rolling 7 Lagos days including today.

---

## Entertainer dashboard — **NEW**

`PLATFORM_ADMIN`, `VENUE_ADMIN` (own venue), `ENTERTAINER` (self only). An
entertainer addressing anyone else's id gets **403**.

```
GET /entertainers/:entertainerId/overview
GET /entertainers/:entertainerId/transactions?limit=&offset=
GET /entertainers/:entertainerId/payouts?limit=&offset=
```

`overview` →

```json
{
  "entertainerId": "uuid", "stageName": "DJ Neptune",
  "tonightKobo": 18400000, "thisWeekKobo": 42150000, "totalKobo": 214000000,
  "pendingPayoutsKobo": 4750000, "paidOutKobo": 209250000
}
```

These are the entertainer's **own share**, not gross tips. There is deliberately
no venue-wide financial figure on any of these routes.

---

## History list shapes

Both paginate as `{total, limit, offset, items}`. Default `limit` 50, max 200,
newest first.

Transactions — `{id, time, amountKobo, entertainerName|null, guest, status, reference}`.
`entertainerName` is null for a venue-wide QR. `guest` is already `"Anonymous"`
when the guest opted out — don't second-guess it.

Payouts — `{id, entertainerName|null, amountKobo, status, reference|null, time, failureReason|null}`.
Statuses `QUEUED`, `PROCESSING`, `SUCCESS`, `FAILED`, `RETRYING`, `CANCELLED`.
`failureReason` is operator-facing prose; surface it on `FAILED`/`RETRYING`.

---

---

## Venue payout account — **NEW**

```
GET  /venues/:venueId/payout-account/status
POST /venues/:venueId/payout-account/bank-details    {accountNumber, bankCode | bankName}
POST /venues/:venueId/payout-account/resolve-account
POST /venues/:venueId/payout-account/confirm-account {confirmedAccountName}
```

`VENUE_ADMIN` (own venue) or `PLATFORM_ADMIN` throughout — including confirm.
Unlike the entertainer case, the venue admin *is* the account holder's
representative, so them confirming their own venue's account is the correct party,
not a bypass.

Three steps, not four: **no identity verification.** A venue is a business entity
vetted when it was onboarded, so "is this really you?" is already answered; the
open question is only whether the account belongs to it, which resolve/confirm
answers. Stated as the judgment call it is.

Response is the same shape as entertainer KYC status, so one component drives both:

```json
{
  "venueId": "uuid", "venueName": "Quilox Nightclub",
  "nextStep": "BANK_DETAILS|RESOLVE_ACCOUNT|CONFIRM_ACCOUNT|DONE",
  "bankName": "Guaranty Trust Bank", "bankCode": "058",
  "accountNumberMasked": "******6789",
  "resolvedAccountName": "QUILOX ENTERTAINMENT LIMITED",
  "accountResolvedAt": "...", "accountConfirmedAt": null,
  "payoutsEnabled": false
}
```

Changing the account clears resolution and confirmation. Until
`accountConfirmedAt` is set, the venue's `VENUE_PAYABLE` balance accrues and nothing
moves; once set, the existing payout sweep picks it up through the same
recipient → transfer → retry machinery as entertainers, with the same
never-drop-the-liability guarantee.

---

## Venue payouts: the venue's share is a SEPARATE list — **CHANGED**

```
GET /venues/:venueId/payouts       → payouts to ENTERTAINERS who performed here
GET /venues/:venueId/own-payouts   → the VENUE'S OWN share        ← NEW
```

`/payouts` no longer includes the venue's own share. Two endpoints rather than one
flagged list, so the two can never be rendered as one undifferentiated set of
rows: "₦475,000 — DJ Neptune" and "₦475,000 — the venue" sitting next to each
other is how a venue ends up adding the wrong column. On `own-payouts`,
`entertainerName` is always `null` because the recipient is the venue.

`GET /venues/:venueId/overview` gains three fields:

| Field | Meaning |
|---|---|
| `ownPendingPayoutsKobo` | The venue's own unpaid share — a **subset** of `pendingPayoutsKobo`, never a separate total to add to it |
| `ownPaidOutKobo` | The venue's own share already transferred |
| `ownPayoutAccountConfirmed` | `false` means its share accrues and nothing moves — link to the payout-account flow |

`pendingPayoutsKobo` keeps its existing meaning (everything unpaid from
transactions here, venue + entertainers) so the existing tile doesn't change
underneath anyone.

## Split rules and platform fee (from round 2, live)

```
GET   /platform/settings       → {platformFeeBps, splittableBps, updatedAt}
PATCH /platform/settings       PLATFORM_ADMIN only
POST  /split-rules            {venueId, entertainerId, entertainerBps, venueBps}
POST  /split-rules/override   PLATFORM_ADMIN only
GET   /split-rules/:id/respond/:token      public — the proposed terms
POST  /split-rules/:id/respond/:token      public — {decision: 'ACCEPT'|'REJECT'}
GET   /split-rules/venue/:venueId          history
GET   /split-rules/venue/:venueId/active   the rule in force (404 if none)
GET   /split-rules/:id/audit               immutable trail
```

- A proposal must **not** include `platformBps` — it is a 400. `entertainerBps +
  venueBps` must equal `splittableBps`.
- `POST /split-rules` returns `consentUrl` + `consentToken` once. The rule is
  `PENDING_ENTERTAINER_APPROVAL` and divides nothing until accepted.
- `/active` 404 means no agreed rule, which is why payment initialization
  refuses. Surface that to the venue as a setup problem, not a payment error.

---

## Venues, entertainers, QR codes (unchanged, live)

`POST|GET /venues`, `GET|PATCH|DELETE /venues/{id}` · `POST|GET /entertainers`,
`GET|PATCH|DELETE /entertainers/{id}`, `POST|DELETE /entertainers/{id}/venues/{venueId}`
· `POST|GET /qr-codes`, `GET|DELETE /qr-codes/{id}`, `POST /qr-codes/{id}/regenerate`

QR codes must encode **`{FRONTEND_URL}/t/{publicToken}`** — the frontend's own
domain, never the API's.

---

## Gaps the frontend should plan around

| Gap | Consequence |
|---|---|
| **Identity verification unavailable** | Every entertainer lands in `REVIEW`. Build for that state as the normal outcome today |
| **No notification delivery** | Consent links and entertainer login links are returned in API responses for manual delivery |
| **No webhook processing in production** | Always rely on `GET /payments/:reference/status`; never assume a webhook settled anything |
| **No `/auth/me`** | Get the venue from `GET /venues` (returns one for a venue admin) |
| **Venue payouts need a confirmed account** | A venue's share accrues until `payout-account/confirm-account` is done. Surface `ownPayoutAccountConfirmed` from the overview |
| **`platformBps` on old split rules** | Rules pre-dating governance are `origin: ADMIN_OVERRIDE`. Don't present those as mutually agreed |

Re-run the audit rather than trusting this file once time has passed:
`curl /api/docs-json` for shapes, and see
[definition-of-done-audit.md](definition-of-done-audit.md) for what is actually
working in production versus merely built.
