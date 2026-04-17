-- CreateEnum
CREATE TYPE "RepeatMode" AS ENUM ('OFF', 'ONE', 'ALL');

-- AlterTable
ALTER TABLE "player_sessions"
  ADD COLUMN "shuffle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "repeat_mode" "RepeatMode" NOT NULL DEFAULT 'OFF';
