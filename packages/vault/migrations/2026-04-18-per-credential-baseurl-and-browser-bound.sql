-- Adds two columns that close security gaps flagged in the proxy audit.
--
-- credentials.base_url: per-tenant upstream host for providers whose URL
--   isn't fixed globally (Azure OpenAI). Null for every other provider.
--
-- app_sessions.browser_bound: captured at /connect handshake time. When
--   true, the proxy middleware requires a matching Origin header on every
--   request, closing the replay-via-non-browser-client loophole.
--
-- Both columns are nullable / default-false, so the migration is
-- forward-compatible: rows written before the migration ran keep working
-- without backfill. drizzle-kit push will not handle these correctly on
-- this schema (see drizzle.config.ts for the known *_not_null trap), so
-- apply this SQL directly in a transaction.
BEGIN;
ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS base_url text;

ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS browser_bound boolean NOT NULL DEFAULT false;
COMMIT;
