-- Split-rule governance: the platform's cut is fixed and admin-only, and a
-- venue/entertainer split only takes effect once the entertainer agrees.

-- CreateEnum
CREATE TYPE "SplitRuleStatus" AS ENUM ('PENDING_ENTERTAINER_APPROVAL', 'ACTIVE', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');
CREATE TYPE "SplitRuleOrigin" AS ENUM ('VENUE_PROPOSAL', 'ADMIN_OVERRIDE');

-- AlterTable: split_rules gains governance columns.
-- effective_from becomes nullable: a proposal nobody has answered is not in
-- force, so it has no date from which it applied.
ALTER TABLE "split_rules" ALTER COLUMN "effective_from" DROP NOT NULL;
ALTER TABLE "split_rules" ALTER COLUMN "effective_from" DROP DEFAULT;

ALTER TABLE "split_rules"
  ADD COLUMN "status" "SplitRuleStatus" NOT NULL DEFAULT 'PENDING_ENTERTAINER_APPROVAL',
  ADD COLUMN "origin" "SplitRuleOrigin" NOT NULL DEFAULT 'VENUE_PROPOSAL',
  ADD COLUMN "entertainer_id" TEXT,
  ADD COLUMN "proposed_by_user_id" TEXT,
  ADD COLUMN "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "responded_at" TIMESTAMP(3),
  ADD COLUMN "response_token_hash" TEXT;

CREATE UNIQUE INDEX "split_rules_response_token_hash_key" ON "split_rules"("response_token_hash");
CREATE INDEX "split_rules_venue_id_status_idx" ON "split_rules"("venue_id", "status");

ALTER TABLE "split_rules" ADD CONSTRAINT "split_rules_entertainer_id_fkey"
  FOREIGN KEY ("entertainer_id") REFERENCES "entertainers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill rows that predate governance. They were never agreed to by an
-- entertainer, so they are labelled ADMIN_OVERRIDE rather than VENUE_PROPOSAL:
-- calling them a mutual agreement would be a lie in the audit trail.
UPDATE "split_rules"
   SET "status" = CASE WHEN "effective_to" IS NULL THEN 'ACTIVE'::"SplitRuleStatus"
                       ELSE 'SUPERSEDED'::"SplitRuleStatus" END,
       "origin" = 'ADMIN_OVERRIDE'::"SplitRuleOrigin",
       "proposed_at" = "created_at";

-- Added AFTER the backfill above, deliberately: every pre-existing row still
-- has the PENDING default at that point while carrying a non-null
-- effective_from, so adding this first fails the whole migration.
-- A rule that is in force must have a date it came into force, and one that is
-- not in force must not pretend to. This is the invariant the ledger relies on.
ALTER TABLE "split_rules" ADD CONSTRAINT "split_rules_active_has_effective_from"
  CHECK (
    ("status" IN ('ACTIVE', 'SUPERSEDED') AND "effective_from" IS NOT NULL)
    OR ("status" IN ('PENDING_ENTERTAINER_APPROVAL', 'REJECTED', 'WITHDRAWN') AND "effective_from" IS NULL)
  );

-- CreateTable: append-only audit trail, immutable by trigger below.
CREATE TABLE "split_rule_audit_events" (
    "id" TEXT NOT NULL,
    "split_rule_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "split_rule_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "split_rule_audit_events_split_rule_id_created_at_idx"
  ON "split_rule_audit_events"("split_rule_id", "created_at");

ALTER TABLE "split_rule_audit_events" ADD CONSTRAINT "split_rule_audit_events_split_rule_id_fkey"
  FOREIGN KEY ("split_rule_id") REFERENCES "split_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An audit trail that can be rewritten is not an audit trail. Same discipline
-- already applied to ledger_entries.
CREATE OR REPLACE FUNCTION split_rule_audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'split_rule_audit_events are immutable: % is not allowed (event %)', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER split_rule_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "split_rule_audit_events"
  FOR EACH ROW EXECUTE FUNCTION split_rule_audit_events_immutable();

-- Record the backfill itself, so the history explains its own starting point.
INSERT INTO "split_rule_audit_events" ("id", "split_rule_id", "event", "actor_type", "detail")
SELECT gen_random_uuid()::text, "id", 'BACKFILLED_PRE_GOVERNANCE', 'SYSTEM',
       jsonb_build_object(
         'note', 'Existing rule predates entertainer consent; labelled ADMIN_OVERRIDE because no entertainer ever agreed to it.',
         'status', "status"::text)
  FROM "split_rules";

-- CreateTable: platform settings, pinned to one row.
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 500,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- One global fee, enforced by the database rather than by convention.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_singleton"
  CHECK ("id" = 'singleton');

-- The platform's cut has to leave something for everyone else.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_fee_bps_range"
  CHECK ("platform_fee_bps" >= 0 AND "platform_fee_bps" <= 10000);

INSERT INTO "platform_settings" ("id", "platform_fee_bps", "updated_at")
VALUES ('singleton', 500, CURRENT_TIMESTAMP);
