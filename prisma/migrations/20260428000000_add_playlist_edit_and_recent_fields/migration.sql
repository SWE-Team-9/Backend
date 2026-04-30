-- Add the playlist fields used by the edit screen and recent-playlists view.
-- These changes keep existing data intact and only extend the schema.

ALTER TYPE "PlaylistType" ADD VALUE IF NOT EXISTS 'SINGLE';
ALTER TYPE "PlaylistType" ADD VALUE IF NOT EXISTS 'COMPILATION';

ALTER TABLE "playlists"
  ADD COLUMN IF NOT EXISTS "cover_image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "release_date" DATE,
  ADD COLUMN IF NOT EXISTS "genre_id" SMALLINT,
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "playlists_genre_id_idx" ON "playlists"("genre_id");

ALTER TABLE "playlists"
  ADD CONSTRAINT "playlists_genre_id_fkey"
  FOREIGN KEY ("genre_id") REFERENCES "genres"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
