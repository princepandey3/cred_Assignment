-- ============================================================
-- AI Content Publishing API — Database Bootstrap
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For full-text search later

-- Create application schema
CREATE SCHEMA IF NOT EXISTS content;

-- Set default search path
ALTER DATABASE ai_content_db SET search_path TO content, public;
