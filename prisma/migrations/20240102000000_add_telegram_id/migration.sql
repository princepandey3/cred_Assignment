-- Migration: add_telegram_id
-- Adds telegram_id column to users table so Telegram accounts can be linked.
-- The column is nullable — a user can exist without linking Telegram.
-- The unique constraint prevents two Telegram accounts mapping to one user.

ALTER TABLE "users" ADD COLUMN "telegram_id" VARCHAR(32);

CREATE UNIQUE INDEX "users_telegram_id_key"
  ON "users"("telegram_id")
  WHERE "telegram_id" IS NOT NULL;
