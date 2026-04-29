-- CreateIndex GIN indexes for full-text search optimization
-- These indexes support the discovery service search queries on tracks, playlists, and user profiles

-- Add GIN index for full-text search on tracks (title + description)
CREATE INDEX IF NOT EXISTS "tracks_title_description_gin_idx"
  ON "tracks" USING GIN (
    to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("description", ''))
  );

-- Add GIN index for full-text search on playlists (title + description)
CREATE INDEX IF NOT EXISTS "playlists_title_description_gin_idx"
  ON "playlists" USING GIN (
    to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("description", ''))
  );

-- Add GIN index for full-text search on user profiles (handle + displayName)
CREATE INDEX IF NOT EXISTS "user_profiles_handle_displayname_gin_idx"
  ON "user_profiles" USING GIN (
    to_tsvector('english', COALESCE("handle", '') || ' ' || COALESCE("display_name", ''))
  );
