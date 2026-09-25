-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED', 'REFUNDED');

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "entertainer_id" TEXT,
    "guest_session_id" TEXT NOT NULL,
    "gross_amount_kobo" INTEGER NOT NULL,
    "guest_display_name" TEXT,
    "display_name_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_external_reference_key" ON "payment_transactions"("external_reference");

-- CreateIndex
CREATE INDEX "payment_transactions_external_reference_idx" ON "payment_transactions"("external_reference");

-- CreateIndex
CREATE INDEX "payment_transactions_venue_id_idx" ON "payment_transactions"("venue_id");

-- CreateIndex
CREATE INDEX "payment_transactions_entertainer_id_idx" ON "payment_transactions"("entertainer_id");

-- CreateIndex
CREATE INDEX "payment_transactions_guest_session_id_idx" ON "payment_transactions"("guest_session_id");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_entertainer_id_fkey" FOREIGN KEY ("entertainer_id") REFERENCES "entertainers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
