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

## Entertainer KYC — **NEW**, the five-step flow

All under `/entertainers/:entertainerId/kyc`. Callable by `PLATFORM_ADMIN`,
`VENUE_ADMIN` (own venue only) and `ENTERTAINER` (self only). Every response is
the same `KycStatus` object, so a client can drive the whole flow from one shape.

```
GET  /status            → current state + nextStep
POST /bank-details      {bankName, bankCode, accountNumber}   → step 1
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
| **No bank-list endpoint** | `bankCode` has to come from somewhere. Either hardcode the ~20 names in `src/payouts/bank-codes.ts`, or call Paystack's `GET /bank` from the frontend. A backend passthrough would be the better fix — not built |
| **Identity verification unavailable** | Every entertainer lands in `REVIEW`. Build for that state as the normal outcome today |
| **No notification delivery** | Consent links and entertainer login links are returned in API responses for manual delivery |
| **No webhook processing in production** | Always rely on `GET /payments/:reference/status`; never assume a webhook settled anything |
| **No `/auth/me`** | Get the venue from `GET /venues` (returns one for a venue admin) |
| **`platformBps` on old split rules** | Rules pre-dating governance are `origin: ADMIN_OVERRIDE`. Don't present those as mutually agreed |

Re-run the audit rather than trusting this file once time has passed:
`curl /api/docs-json` for shapes, and see
[definition-of-done-audit.md](definition-of-done-audit.md) for what is actually
working in production versus merely built.
