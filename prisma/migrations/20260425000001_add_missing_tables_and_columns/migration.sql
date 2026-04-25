-- ============================================================================
-- Migration: Add missing tables and columns
-- Adds columns to user_subscriptions, and creates trial_redemptions,
-- user_notification_preferences, user_search_indexable, user_billing,
-- payment_methods, reports, and appeals.
-- ============================================================================

-- NOTE:
-- Do not create extensions here (may require elevated DB privileges in some envs).
-- The trigram index is created conditionally below only when pg_trgm already exists.

-- ----------------------------------------------------------------------------
-- 1. Add missing columns to user_subscriptions
-- ----------------------------------------------------------------------------
ALTER TABLE "user_subscriptions"
  ADD COLUMN IF NOT EXISTS "trial_start"                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "trial_end"                     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_failure_at"            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_failure_grace_ends_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_method_summary"        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "payment_method"                JSONB;

-- ----------------------------------------------------------------------------
-- 2. New enum types needed by reports / appeals
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ReportTargetType" AS ENUM ('TRACK', 'USER', 'PLAYLIST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('COPYRIGHT', 'INAPPROPRIATE', 'SPAM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add UNDER_REVIEW to existing ReportStatus enum (cannot remove IN_REVIEW safely)
DO $$ BEGIN
  ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. user_notification_preferences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
  "user_id"  UUID    NOT NULL,
  "likes"    BOOLEAN NOT NULL DEFAULT true,
  "comments" BOOLEAN NOT NULL DEFAULT true,
  "follows"  BOOLEAN NOT NULL DEFAULT true,
  "reposts"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_notification_preferences"
  ADD CONSTRAINT "user_notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "user_notification_preferences"
  VALIDATE CONSTRAINT "user_notification_preferences_user_id_fkey";

-- ----------------------------------------------------------------------------
-- 4. user_search_indexable
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user_search_indexable" (
  "user_id"       UUID        NOT NULL,
  "username"      CITEXT      NOT NULL,
  "display_name"  TEXT        NOT NULL,
  "search_vector" TEXT        NOT NULL,
  "updated_at"    TIMESTAMPTZ NOT NULL,
  CONSTRAINT "user_search_indexable_pkey" PRIMARY KEY ("user_id")
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "user_search_indexable_search_vector_idx"
      ON "user_search_indexable" USING GIN ("search_vector" gin_trgm_ops);
  ELSE
    RAISE NOTICE 'Skipping user_search_indexable trigram index because pg_trgm is not installed';
  END IF;
END
$$;

ALTER TABLE "user_search_indexable"
  ADD CONSTRAINT "user_search_indexable_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "user_search_indexable"
  VALIDATE CONSTRAINT "user_search_indexable_user_id_fkey";

-- ----------------------------------------------------------------------------
-- 5. trial_redemptions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "trial_redemptions" (
  "id"                       UUID        NOT NULL,
  "user_id"                  UUID        NOT NULL,
  "plan_code"                TEXT        NOT NULL,
  "redeemed_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_subscription_id" TEXT,
  CONSTRAINT "trial_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trial_redemptions_user_id_plan_code_key"
  ON "trial_redemptions"("user_id", "plan_code");

CREATE INDEX IF NOT EXISTS "trial_redemptions_user_id_idx"
  ON "trial_redemptions"("user_id");

ALTER TABLE "trial_redemptions"
  ADD CONSTRAINT "trial_redemptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "trial_redemptions"
  VALIDATE CONSTRAINT "trial_redemptions_user_id_fkey";

-- ----------------------------------------------------------------------------
-- 6. user_billing
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user_billing" (
  "user_id"           UUID NOT NULL,
  "stripe_customer_id" TEXT NOT NULL,
  CONSTRAINT "user_billing_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_billing_stripe_customer_id_key"
  ON "user_billing"("stripe_customer_id");

ALTER TABLE "user_billing"
  ADD CONSTRAINT "user_billing_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "user_billing"
  VALIDATE CONSTRAINT "user_billing_user_id_fkey";

-- ----------------------------------------------------------------------------
-- 7. payment_methods
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id"                       UUID        NOT NULL,
  "user_id"                  UUID        NOT NULL,
  "stripe_payment_method_id" TEXT        NOT NULL,
  "brand"                    VARCHAR(20) NOT NULL,
  "last4"                    CHAR(4)     NOT NULL,
  "exp_month"                INTEGER     NOT NULL,
  "exp_year"                 INTEGER     NOT NULL,
  "cardholder_name"          VARCHAR(255),
  "is_default"               BOOLEAN     NOT NULL DEFAULT false,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_stripe_payment_method_id_key"
  ON "payment_methods"("stripe_payment_method_id");

CREATE INDEX IF NOT EXISTS "payment_methods_user_id_idx"
  ON "payment_methods"("user_id");

ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "payment_methods"
  VALIDATE CONSTRAINT "payment_methods_user_id_fkey";

-- ----------------------------------------------------------------------------
-- 8. reports
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "reports" (
  "id"          UUID               NOT NULL,
  "reporter_id" UUID               NOT NULL,
  "target_type" "ReportTargetType" NOT NULL,
  "target_id"   UUID               NOT NULL,
  "reason"      "ReportReason"     NOT NULL,
  "description" TEXT,
  "status"      "ReportStatus"     NOT NULL DEFAULT 'PENDING',
  "created_at"  TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ,
  "resolved_by" UUID,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reports_reporter_id_idx"  ON "reports"("reporter_id");
CREATE INDEX IF NOT EXISTS "reports_target_id_idx"    ON "reports"("target_id");
CREATE INDEX IF NOT EXISTS "reports_status_idx"        ON "reports"("status");
CREATE INDEX IF NOT EXISTS "reports_target_type_idx"   ON "reports"("target_type");
CREATE INDEX IF NOT EXISTS "reports_created_at_idx"    ON "reports"("created_at");

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_reporter_id_fkey"
  FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_resolved_by_fkey"
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "reports" VALIDATE CONSTRAINT "reports_reporter_id_fkey";
ALTER TABLE "reports" VALIDATE CONSTRAINT "reports_resolved_by_fkey";

-- ----------------------------------------------------------------------------
-- 9. appeals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "appeals" (
  "id"               UUID           NOT NULL,
  "report_id"        UUID           NOT NULL,
  "user_id"          UUID           NOT NULL,
  "message"          TEXT           NOT NULL,
  "status"           "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "created_at"       TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"      TIMESTAMPTZ,
  "resolution_notes" TEXT,
  "resolved_by"      UUID,
  CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "appeals_report_id_idx"  ON "appeals"("report_id");
CREATE INDEX IF NOT EXISTS "appeals_user_id_idx"    ON "appeals"("user_id");
CREATE INDEX IF NOT EXISTS "appeals_status_idx"      ON "appeals"("status");
CREATE INDEX IF NOT EXISTS "appeals_created_at_idx"  ON "appeals"("created_at");

ALTER TABLE "appeals"
  ADD CONSTRAINT "appeals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "appeals"
  ADD CONSTRAINT "appeals_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "appeals"
  ADD CONSTRAINT "appeals_resolved_by_fkey"
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "appeals" VALIDATE CONSTRAINT "appeals_user_id_fkey";
ALTER TABLE "appeals" VALIDATE CONSTRAINT "appeals_report_id_fkey";
ALTER TABLE "appeals" VALIDATE CONSTRAINT "appeals_resolved_by_fkey";
