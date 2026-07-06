ALTER TABLE "claimnet"."api_keys" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill (security-critical): before this migration, OAuth refresh rotation
-- marked a consumed row by overloading expires_at with the epoch sentinel
-- (to_timestamp(0)) — see refreshOAuthTokenBundle, F38 fix of 2026-06-29.
-- The new refresh gate deliberately no longer requires expires_at > NOW()
-- (that overload is the 1h refresh bug), so any historical consumed row whose
-- refresh_token_expires_at is still in the future would become refreshable
-- again — resurrecting a rotated-away token family. Stamp those rows consumed.
-- consumed_at = to_timestamp(0) (not NOW()) signals "consumed at an unknown
-- historical time" and keeps backfilled rows distinguishable from rows
-- consumed by the new code path.
UPDATE "claimnet"."api_keys"
SET "consumed_at" = to_timestamp(0)
WHERE "key_type" = 'oauth' AND "consumed_at" IS NULL AND "expires_at" = to_timestamp(0);
