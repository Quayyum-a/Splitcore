-- Phase 6 (KYC half) and the entertainer's first way into their own data.

-- AlterEnum: entertainers get a role of their own. Read-only by design, and
-- only ever over their own records.
ALTER TYPE "Role" ADD VALUE 'ENTERTAINER';

-- AlterTable: onboarding state.
ALTER TABLE "entertainers"
  ADD COLUMN "bank_code" TEXT,
  ADD COLUMN "resolved_account_name" TEXT,
  ADD COLUMN "account_resolved_at" TIMESTAMP(3),
  ADD COLUMN "account_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "kyc_submitted_at" TIMESTAMP(3),
  ADD COLUMN "kyc_verified_at" TIMESTAMP(3),
  ADD COLUMN "kyc_failure_reason" TEXT,
  ADD COLUMN "identity_check_type" TEXT,
  ADD COLUMN "identity_checked_at" TIMESTAMP(3);

-- Only BVN or NIN are ever checked, and only the TYPE is recorded. The number
-- itself is passed to the provider and never persisted, per the spec's
-- "must not unnecessarily store sensitive identity information".
ALTER TABLE "entertainers" ADD CONSTRAINT "entertainers_identity_check_type_known"
  CHECK ("identity_check_type" IS NULL OR "identity_check_type" IN ('BVN', 'NIN'));

-- A confirmed account must have been resolved first: confirming a name the bank
-- never returned would defeat the point of the step.
ALTER TABLE "entertainers" ADD CONSTRAINT "entertainers_confirmed_implies_resolved"
  CHECK ("account_confirmed_at" IS NULL OR "resolved_account_name" IS NOT NULL);

-- CreateTable: one-time entertainer login links.
CREATE TABLE "entertainer_login_tokens" (
    "id" TEXT NOT NULL,
    "entertainer_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entertainer_login_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entertainer_login_tokens_token_hash_key"
  ON "entertainer_login_tokens"("token_hash");
CREATE INDEX "entertainer_login_tokens_entertainer_id_created_at_idx"
  ON "entertainer_login_tokens"("entertainer_id", "created_at");

ALTER TABLE "entertainer_login_tokens" ADD CONSTRAINT "entertainer_login_tokens_entertainer_id_fkey"
  FOREIGN KEY ("entertainer_id") REFERENCES "entertainers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes the Phase 7 dashboard aggregates read on every request. Without them
-- "tonight's totals" degrades into a sequential scan as volume grows.
CREATE INDEX IF NOT EXISTS "payment_transactions_venue_id_status_created_at_idx"
  ON "payment_transactions"("venue_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_transactions_entertainer_id_status_created_at_idx"
  ON "payment_transactions"("entertainer_id", "status", "created_at");
