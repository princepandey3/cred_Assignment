-- ============================================================
-- Migration: 20240101000000_init
-- AI Content Publishing API — Initial Schema
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Enums ───────────────────────────────────────────────────

CREATE TYPE "Platform" AS ENUM (
  'TWITTER',
  'LINKEDIN',
  'INSTAGRAM',
  'FACEBOOK',
  'THREADS',
  'MEDIUM',
  'DEVTO'
);

CREATE TYPE "PostType" AS ENUM (
  'THREAD',
  'ARTICLE',
  'SHORT_FORM',
  'LONG_FORM',
  'CAROUSEL',
  'STORY'
);

CREATE TYPE "Tone" AS ENUM (
  'PROFESSIONAL',
  'CASUAL',
  'HUMOROUS',
  'INSPIRATIONAL',
  'EDUCATIONAL',
  'PERSUASIVE',
  'STORYTELLING'
);

CREATE TYPE "Language" AS ENUM (
  'EN', 'ES', 'FR', 'DE', 'PT', 'HI', 'ZH', 'JA', 'AR'
);

CREATE TYPE "PostStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "PlatformPostStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'SKIPPED'
);

-- ─── Tables ──────────────────────────────────────────────────

CREATE TABLE "users" (
  "id"                UUID          NOT NULL DEFAULT uuid_generate_v4(),
  "email"             VARCHAR(255)  NOT NULL,
  "password_hash"     VARCHAR(255)  NOT NULL,
  "name"              VARCHAR(150)  NOT NULL,
  "bio"               TEXT,
  "default_tone"      "Tone"        NOT NULL DEFAULT 'PROFESSIONAL',
  "default_language"  "Language"    NOT NULL DEFAULT 'EN',
  "is_active"         BOOLEAN       NOT NULL DEFAULT true,
  "email_verified_at" TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_accounts" (
  "id"                  UUID          NOT NULL DEFAULT uuid_generate_v4(),
  "user_id"             UUID          NOT NULL,
  "platform"            "Platform"    NOT NULL,
  "access_token_enc"    TEXT          NOT NULL,
  "refresh_token_enc"   TEXT,
  "handle"              VARCHAR(100)  NOT NULL,
  "token_expires_at"    TIMESTAMPTZ,
  "is_active"           BOOLEAN       NOT NULL DEFAULT true,
  "connected_at"        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_keys" (
  "id"                  UUID          NOT NULL DEFAULT uuid_generate_v4(),
  "user_id"             UUID          NOT NULL,
  "openai_key_enc"      TEXT,
  "anthropic_key_enc"   TEXT,
  "gemini_key_enc"      TEXT,
  "created_at"          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "posts" (
  "id"          UUID          NOT NULL DEFAULT uuid_generate_v4(),
  "user_id"     UUID          NOT NULL,
  "idea"        TEXT          NOT NULL,
  "post_type"   "PostType"    NOT NULL,
  "tone"        "Tone"        NOT NULL,
  "language"    "Language"    NOT NULL DEFAULT 'EN',
  "model_used"  VARCHAR(100)  NOT NULL,
  "publish_at"  TIMESTAMPTZ,
  "status"      "PostStatus"  NOT NULL DEFAULT 'DRAFT',
  "deleted_at"  TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_posts" (
  "id"                UUID                  NOT NULL DEFAULT uuid_generate_v4(),
  "post_id"           UUID                  NOT NULL,
  "social_account_id" UUID,
  "platform"          "Platform"            NOT NULL,
  "content"           TEXT                  NOT NULL,
  "metadata"          JSONB,
  "status"            "PlatformPostStatus"  NOT NULL DEFAULT 'PENDING',
  "external_id"       VARCHAR(255),
  "published_at"      TIMESTAMPTZ,
  "error_message"     TEXT,
  "attempts"          INTEGER               NOT NULL DEFAULT 0,
  "last_attempt_at"   TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_posts_pkey" PRIMARY KEY ("id")
);

-- ─── Unique Constraints ──────────────────────────────────────

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_key" UNIQUE ("email");

ALTER TABLE "social_accounts"
  ADD CONSTRAINT "social_accounts_user_id_platform_key" UNIQUE ("user_id", "platform");

ALTER TABLE "ai_keys"
  ADD CONSTRAINT "ai_keys_user_id_key" UNIQUE ("user_id");

ALTER TABLE "platform_posts"
  ADD CONSTRAINT "platform_posts_post_id_platform_key" UNIQUE ("post_id", "platform");

-- ─── Foreign Keys ────────────────────────────────────────────

ALTER TABLE "social_accounts"
  ADD CONSTRAINT "social_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "ai_keys"
  ADD CONSTRAINT "ai_keys_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "platform_posts"
  ADD CONSTRAINT "platform_posts_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;

ALTER TABLE "platform_posts"
  ADD CONSTRAINT "platform_posts_social_account_id_fkey"
  FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL;

-- ─── Performance Indexes ─────────────────────────────────────

-- users
CREATE INDEX "users_email_idx"       ON "users" ("email");
CREATE INDEX "users_created_at_idx"  ON "users" ("created_at");

-- social_accounts
CREATE INDEX "social_accounts_user_id_idx"        ON "social_accounts" ("user_id");
CREATE INDEX "social_accounts_platform_idx"        ON "social_accounts" ("platform");
CREATE INDEX "social_accounts_token_expires_idx"   ON "social_accounts" ("token_expires_at")
  WHERE "token_expires_at" IS NOT NULL;            -- partial index — only expiring tokens

-- ai_keys
CREATE INDEX "ai_keys_user_id_idx" ON "ai_keys" ("user_id");

-- posts
CREATE INDEX "posts_user_id_idx"          ON "posts" ("user_id");
CREATE INDEX "posts_status_idx"           ON "posts" ("status");
CREATE INDEX "posts_publish_at_idx"       ON "posts" ("publish_at")
  WHERE "publish_at" IS NOT NULL;                  -- partial index — only scheduled posts
CREATE INDEX "posts_user_status_idx"      ON "posts" ("user_id", "status");
CREATE INDEX "posts_user_created_idx"     ON "posts" ("user_id", "created_at" DESC);
CREATE INDEX "posts_soft_delete_idx"      ON "posts" ("deleted_at")
  WHERE "deleted_at" IS NULL;                      -- partial index — active posts only

-- platform_posts
CREATE INDEX "platform_posts_post_id_idx"         ON "platform_posts" ("post_id");
CREATE INDEX "platform_posts_platform_idx"         ON "platform_posts" ("platform");
CREATE INDEX "platform_posts_status_idx"           ON "platform_posts" ("status");
CREATE INDEX "platform_posts_status_published_idx" ON "platform_posts" ("status", "published_at");
CREATE INDEX "platform_posts_social_account_idx"   ON "platform_posts" ("social_account_id")
  WHERE "social_account_id" IS NOT NULL;

-- ─── Updated-at Trigger ──────────────────────────────────────
-- Automatically refresh updated_at on every row update.

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_social_accounts
  BEFORE UPDATE ON "social_accounts"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_ai_keys
  BEFORE UPDATE ON "ai_keys"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_posts
  BEFORE UPDATE ON "posts"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_platform_posts
  BEFORE UPDATE ON "platform_posts"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
