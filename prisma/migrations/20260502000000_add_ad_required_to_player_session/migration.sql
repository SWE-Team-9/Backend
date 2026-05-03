-- AlterTable: add ad_required column to player_sessions
-- This column tracks whether the user must watch an ad before the next track plays.
ALTER TABLE "player_sessions"
  ADD COLUMN IF NOT EXISTS "ad_required" BOOLEAN NOT NULL DEFAULT false;
