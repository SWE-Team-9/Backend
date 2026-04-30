-- AlterTable: add backend-managed queue state to player_sessions
ALTER TABLE "player_sessions"
  ADD COLUMN IF NOT EXISTS "current_queue_index"       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "real_tracks_since_last_ad" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "queue_context"             jsonb;
