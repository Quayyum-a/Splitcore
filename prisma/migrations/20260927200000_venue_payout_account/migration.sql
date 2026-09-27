-- A venue's own payout destination. Same shape as the entertainer's, for the same
-- reason: a destination is only trustworthy once someone has confirmed the bank's
-- own name for it. VENUE_PAYABLE obligations previously had nowhere to go and
-- simply accrued.

ALTER TABLE "venues"
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_code" TEXT,
  ADD COLUMN "account_number" TEXT,
  ADD COLUMN "resolved_account_name" TEXT,
  ADD COLUMN "account_resolved_at" TIMESTAMP(3),
  ADD COLUMN "account_confirmed_at" TIMESTAMP(3);

-- Confirming a name the bank never returned would defeat the point of the step.
-- Mirrors entertainers_confirmed_implies_resolved.
ALTER TABLE "venues" ADD CONSTRAINT "venues_confirmed_implies_resolved"
  CHECK ("account_confirmed_at" IS NULL OR "resolved_account_name" IS NOT NULL);

-- The payout sweep scans for open payouts and joins to the destination; this is
-- the venue side of the indexes the entertainer side already has.
CREATE INDEX IF NOT EXISTS "payouts_status_ledger_account_id_idx"
  ON "payouts"("status", "ledger_account_id");
