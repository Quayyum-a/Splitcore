# Phase 3: Payment Testing Guide

This guide explains how to test the complete payment flow locally with Paystack test mode.

## Prerequisites

1. **Paystack Test Account**: Sign up at https://dashboard.paystack.com/signup
2. **Test API Keys**: Get from https://dashboard.paystack.com/#/settings/developer
3. **Configure Environment**:
   ```bash
   # In .env
   PAYSTACK_SECRET_KEY=sk_test_your_test_secret_key
   PAYSTACK_PUBLIC_KEY=pk_test_your_test_public_key
   APP_URL=http://localhost:3000
   ```

4. **Database Setup**:
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```

5. **Start Services**:
   ```bash
   # Terminal 1: Redis (required for BullMQ)
   docker run -p 6379:6379 redis:alpine
   
   # Terminal 2: Application
   npm run start:dev
   ```

## Complete Payment Flow Test

### Step 1: Create Guest Session

Scan a QR code to create a guest session:

```bash
curl http://localhost:3000/t/quilox-vip-table-1-dj-neptune-0001
```

**Response:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "venueName": "Quilox Nightclub",
  "entertainerName": "DJ Neptune",
  "qrLocation": "VIP Table 1",
  "expiresAt": "2026-09-26T10:00:00.000Z"
}
```

### Step 2: Initialize Payment

```bash
curl -X POST http://localhost:3000/payments/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "amountKobo": 500000,
    "guestDisplayName": "Anonymous Fan",
    "displayNameEnabled": true,
    "email": "guest@example.com"
  }'
```

**Response:**
```json
{
  "transactionId": "pay-123-456-789",
  "reference": "pay_abc123def456",
  "authorizationUrl": "https://checkout.paystack.com/xyz",
  "accessCode": "xyz123",
  "amountKobo": 500000,
  "status": "CREATED"
}
```

### Step 3: Complete Payment

1. Open the `authorizationUrl` in a browser
2. Use Paystack test card: `4084084084084081`
3. CVV: `408`, Expiry: any future date, PIN: `0000`, OTP: `123456`
4. Complete the payment

### Step 4: Webhook Processing

Paystack will send a `charge.success` webhook to your endpoint. To test locally:

**Option A: Use Paystack Webhook Testing (in dashboard)**
1. Go to https://dashboard.paystack.com/#/settings/developer
2. Click "Test Webhook" 
3. Select "charge.success" event
4. Send to `http://your-public-url/webhooks/paystack`

**Option B: Use ngrok for local testing**
```bash
# Terminal 3: Expose local server
ngrok http 3000

# Update Paystack webhook URL to: https://your-ngrok-url/webhooks/paystack
```

**Option C: Manually trigger with curl (for testing)**
```bash
# Generate signature
echo -n '{"event":"charge.success","data":{"reference":"pay_abc123def456","status":"success","amount":500000}}' | \
  openssl dgst -sha512 -hmac "sk_test_your_secret_key" | \
  cut -d' ' -f2

curl -X POST http://localhost:3000/webhooks/paystack \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: <signature_from_above>" \
  -d '{
    "event": "charge.success",
    "data": {
      "reference": "pay_abc123def456",
      "status": "success",
      "amount": 500000,
      "paid_at": "2026-09-25T10:00:00.000Z",
      "id": 12345
    }
  }'
```

### Step 5: Verify Payment Status

```bash
curl http://localhost:3000/payments/pay_abc123def456/status
```

**Response:**
```json
{
  "transactionId": "pay-123-456-789",
  "reference": "pay_abc123def456",
  "status": "SUCCESS",
  "amountKobo": 500000,
  "venueName": "Quilox Nightclub",
  "entertainerName": "DJ Neptune",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:05:00.000Z"
}
```

## What Happens After Webhook

When webhook processes `charge.success`:

### 1. Payment Verification
- Webhook signature verified (HMAC SHA512)
- Payment verified against Paystack API
- Amount matches our record
- Duplicate check (idempotency)

### 2. Ledger Entries Created

For ₦5,000 tip with 70/25/5 split:

```
DEBIT  PROCESSOR_CLEARING    ₦5,000  (money enters)
CREDIT ENTERTAINER_PAYABLE   ₦3,500  (DJ Neptune 70%)
CREDIT VENUE_PAYABLE         ₦1,250  (Quilox 25%)
CREDIT PLATFORM_REVENUE      ₦250    (Splitcore 5%)
```

### 3. Payout Triggered

For DJ Neptune (KYC status = VERIFIED):
- Paystack recipient created (if not exists)
- Transfer initiated immediately
- Transfer reference: `txf_unique_reference`
- Amount: ₦3,500
- Status: PROCESSING → SUCCESS (via transfer.success webhook)

For entertainers NOT VERIFIED:
- Payout created with status QUEUED
- Will process when KYC completes

## Database State After Successful Payment

```sql
-- Check payment transaction
SELECT id, external_reference, gross_amount_kobo, status 
FROM payment_transactions 
WHERE external_reference = 'pay_abc123def456';

-- Check ledger entries (should be 4: 1 debit, 3 credits)
SELECT account_id, direction, amount_kobo 
FROM ledger_entries 
WHERE transaction_id = (
  SELECT id FROM payment_transactions 
  WHERE external_reference = 'pay_abc123def456'
);

-- Check ledger balances
SELECT type, owner_id, (
  SELECT SUM(CASE WHEN direction = 'CREDIT' THEN amount_kobo ELSE -amount_kobo END)
  FROM ledger_entries 
  WHERE account_id = ledger_accounts.id
) as balance
FROM ledger_accounts
WHERE owner_id IS NOT NULL OR type = 'PLATFORM_REVENUE';

-- Check payout status
SELECT id, amount_kobo, status, transfer_reference, attempted_at, completed_at
FROM payouts
WHERE transaction_id = (
  SELECT id FROM payment_transactions 
  WHERE external_reference = 'pay_abc123def456'
);

-- Check webhook event
SELECT id, event_type, processing_status, received_at, processed_at
FROM webhook_events
WHERE payload->>'data'->>'reference' = 'pay_abc123def456';
```

## Testing Different Scenarios

### Scenario 1: Venue-Only Tip (No Entertainer)
```bash
# Use venue-only QR code
curl http://localhost:3000/t/quilox-general-area-bar-counter-02

# Initialize payment (no entertainer)
# Venue gets 95% (70% entertainer share + 25% venue share)
# Platform gets 5%
```

### Scenario 2: Unverified Entertainer
```bash
# Use QR for DJ Spinall (KYC status: PENDING)
curl http://localhost:3000/t/cubana-table-5-dj-spinall-00000003

# Initialize and complete payment
# Ledger entries created normally
# Payout status: QUEUED (waiting for KYC)
```

### Scenario 3: Missing Split Rule
```bash
# Temporarily deactivate all split rules for a venue
# Try to initialize payment
# Should fail with: "venue split configuration is not set up"
```

### Scenario 4: Payment Verification Fallback
```bash
# Complete payment but webhook hasn't fired yet
# Poll status endpoint
curl http://localhost:3000/payments/pay_abc123def456/status

# Should verify directly with Paystack API
# Update status from CREATED → SUCCESS
```

## Reconciliation Check

After several payments, verify reconciliation:

```bash
# Check ledger vs Paystack balance
# This runs automatically every hour via @Cron

# Manual trigger (TODO: expose admin endpoint)
# Should log:
# - Ledger PROCESSOR_CLEARING balance
# - Actual Paystack balance
# - Any drift detected
```

## Expected Balances

After processing 1x ₦5,000 tip to DJ Neptune:

```
PROCESSOR_CLEARING:    ₦5,000  (debit - money in)
ENTERTAINER_PAYABLE:   ₦0      (₦3,500 credited, then debited for payout)
VENUE_PAYABLE:         ₦1,250  (credit - awaiting batch payout)
PLATFORM_REVENUE:      ₦250    (credit - our revenue)

Paystack Balance:      ₦5,000
Payouts Processed:     ₦3,500  (to DJ Neptune)
Payouts Pending:       ₦1,250  (venue batch)
```

## Troubleshooting

### Webhook Not Received
- Check Paystack dashboard webhook logs
- Verify ngrok tunnel is active
- Check webhook URL in Paystack settings
- Look for signature verification errors in logs

### Payment Stuck in CREATED
- Webhook may not have fired
- Check webhook event logs
- Use status endpoint for manual verification
- Check BullMQ queue for processing errors

### Payout Not Triggered
- Verify entertainer KYC status is VERIFIED
- Check payout table for status
- Look for bank account details (required)
- Check PayoutsService logs

### Ledger Not Balanced
- Check reconciliation logs
- Verify all payment transactions have entries
- Sum debits vs credits per transaction
- Should never happen (enforced at write time)

## Test Data Summary

| Entertainer | KYC Status | Bank Details | Payout Behavior |
|-------------|------------|--------------|-----------------|
| DJ Neptune | VERIFIED | ✓ GTBank | Instant payout |
| DJ Spinall | PENDING | ✓ Access Bank | Queued |
| Wizkid | REVIEW | ✗ None | Queued |
| Burna Boy | NOT_STARTED | ✓ Zenith Bank | Queued |
| Davido | FAILED | ✗ None | Queued |

| Venue | Split Rule | Behavior |
|-------|------------|----------|
| Quilox | 70/25/5 | Active |
| Cubana | 65/30/5 | Active |
| Eko Hotel | 80/15/5 | Active |

## Next Steps

After successful local testing:
1. Deploy to staging environment
2. Configure production Paystack keys (live mode)
3. Set up monitoring/alerts for reconciliation drift
4. Implement admin dashboard for manual reconciliation
5. Add retry mechanisms for failed payouts
