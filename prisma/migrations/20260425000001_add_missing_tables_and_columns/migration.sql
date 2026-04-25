-- ============================================================================
-- Hotfix Migration: unblock runtime by adding only missing subscription columns
-- ============================================================================

ALTER TABLE "user_subscriptions"
  ADD COLUMN IF NOT EXISTS "trial_start"                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "trial_end"                     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_failure_at"            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_failure_grace_ends_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "payment_method_summary"        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "payment_method"                JSONB;
