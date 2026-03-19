/*
  Warnings:

  - The values [NON_BINARY] on the enum `Gender` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Gender_new" AS ENUM ('MALE', 'FEMALE', 'PREFER_NOT_TO_SAY');
ALTER TABLE "users" ALTER COLUMN "gender" TYPE "Gender_new" USING ("gender"::text::"Gender_new");
ALTER TYPE "Gender" RENAME TO "Gender_old";
ALTER TYPE "Gender_new" RENAME TO "Gender";
DROP TYPE "Gender_old";
COMMIT;

-- CreateTable
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "homepage_url" TEXT,
    "redirect_uris" TEXT[],
    "allowed_scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit" INTEGER NOT NULL DEFAULT 1000,
    "rate_limit_window" INTEGER NOT NULL DEFAULT 3600,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_auth_codes" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "scope" VARCHAR(255) NOT NULL,
    "code_challenge" TEXT,
    "code_challenge_method" VARCHAR(50),
    "redirect_uri" VARCHAR(2048) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_access_tokens" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "refresh_token_hash" TEXT,
    "scope" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "device_info" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_client_id_key" ON "api_clients"("client_id");

-- CreateIndex
CREATE INDEX "api_clients_client_id_idx" ON "api_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_auth_codes_code_hash_key" ON "api_auth_codes"("code_hash");

-- CreateIndex
CREATE INDEX "api_auth_codes_client_id_idx" ON "api_auth_codes"("client_id");

-- CreateIndex
CREATE INDEX "api_auth_codes_user_id_idx" ON "api_auth_codes"("user_id");

-- CreateIndex
CREATE INDEX "api_auth_codes_code_hash_idx" ON "api_auth_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "api_access_tokens_access_token_hash_key" ON "api_access_tokens"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "api_access_tokens_refresh_token_hash_key" ON "api_access_tokens"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "api_access_tokens_client_id_idx" ON "api_access_tokens"("client_id");

-- CreateIndex
CREATE INDEX "api_access_tokens_user_id_idx" ON "api_access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "api_access_tokens_access_token_hash_idx" ON "api_access_tokens"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "api_auth_codes" ADD CONSTRAINT "api_auth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_auth_codes" ADD CONSTRAINT "api_auth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_access_tokens" ADD CONSTRAINT "api_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_access_tokens" ADD CONSTRAINT "api_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
