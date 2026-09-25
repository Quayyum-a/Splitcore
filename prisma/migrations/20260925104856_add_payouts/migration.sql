-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "ledger_account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "transfer_reference" TEXT,
    "recipient_code" TEXT,
    "amount_kobo" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'QUEUED',
    "attempted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_transfer_reference_key" ON "payouts"("transfer_reference");

-- CreateIndex
CREATE INDEX "payouts_ledger_account_id_idx" ON "payouts"("ledger_account_id");

-- CreateIndex
CREATE INDEX "payouts_transaction_id_idx" ON "payouts"("transaction_id");

-- CreateIndex
CREATE INDEX "payouts_transfer_reference_idx" ON "payouts"("transfer_reference");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
