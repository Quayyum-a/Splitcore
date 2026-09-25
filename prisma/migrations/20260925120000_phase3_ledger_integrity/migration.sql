-- Phase 3 hardening: ledger integrity enforced by the database, not just by
-- application code, plus the columns settlement/payout idempotency relies on.

-- DropIndex (superseded by the composite unique index below / the unique constraint)
DROP INDEX "payouts_ledger_account_id_idx";
DROP INDEX "payouts_transfer_reference_idx";

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN "split_rule_id" TEXT;
ALTER TABLE "payouts" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- One payout obligation per recipient account per payment.
CREATE UNIQUE INDEX "payouts_ledger_account_id_transaction_id_key" ON "payouts"("ledger_account_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_split_rule_id_fkey" FOREIGN KEY ("split_rule_id") REFERENCES "split_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- System accounts (PLATFORM_REVENUE, PROCESSOR_CLEARING) have owner_id NULL.
-- The (type, owner_id) unique index does not stop duplicates there because
-- NULLs are distinct, so enforce one system account per type explicitly.
CREATE UNIQUE INDEX "ledger_accounts_system_type_key" ON "ledger_accounts"("type") WHERE "owner_id" IS NULL;

-- Amounts are positive integer kobo; direction carries the sign.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_amount_positive" CHECK ("gross_amount_kobo" > 0);

-- Immutability: ledger entries can never be updated or deleted. Corrections
-- are new compensating entries. (TRUNCATE is statement-level and unaffected,
-- which test cleanup relies on.)
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are immutable: % is not allowed (entry %)', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

-- Balance: at COMMIT, every payment transaction touched in this database
-- transaction must have sum(debits) = sum(credits). A deferred constraint
-- trigger lets a multi-row posting be inserted row by row, then rejects the
-- whole database transaction if the final state doesn't balance.
CREATE OR REPLACE FUNCTION ledger_entries_assert_balanced() RETURNS trigger AS $$
DECLARE
  imbalance BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_kobo::BIGINT ELSE -amount_kobo::BIGINT END), 0)
    INTO imbalance
    FROM "ledger_entries"
   WHERE transaction_id = NEW.transaction_id;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'unbalanced ledger for transaction %: debits - credits = % kobo', NEW.transaction_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_assert_balanced();
