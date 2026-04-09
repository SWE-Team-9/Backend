-- CreateTable
CREATE TABLE IF NOT EXISTS "playback_progress" (
    "user_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "playback_progress_pkey" PRIMARY KEY ("user_id","track_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "player_sessions" (
    "user_id" UUID NOT NULL,
    "current_track_id" UUID,
    "position_seconds" INTEGER NOT NULL DEFAULT 0,
    "is_playing" BOOLEAN NOT NULL DEFAULT false,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "queue_track_ids" UUID[],
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "player_sessions_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_current_track_id_fkey" FOREIGN KEY ("current_track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (unique constraints pushed via db push)
CREATE UNIQUE INDEX IF NOT EXISTS "track_likes_user_id_track_id_key" ON "track_likes"("user_id", "track_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "track_reposts_user_id_track_id_key" ON "track_reposts"("user_id", "track_id");
