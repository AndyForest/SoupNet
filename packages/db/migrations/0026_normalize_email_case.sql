-- Normalize stored emails to canonical lowercase form (2026-07-02).
--
-- Registration stored emails as typed while invite creation lowercased them,
-- so exact-match comparisons (pending invitations, waitlist promotion,
-- signup-cap reservation counting) silently missed for any user who signed
-- up with non-lowercase casing. The application now canonicalizes at every
-- write and lookup boundary (apps/backend/src/lib/normalize-email.ts); this
-- migration brings pre-existing rows onto the same canonical form.
--
-- Collision guard: if two accounts ever differed only by case, lowercasing
-- both would violate users_email_unique and abort startup migrations. Only
-- the oldest row in each case-insensitive group is lowercased, and none are
-- when an exact-lowercase row already exists (both subqueries evaluate
-- against the statement-start snapshot, so the guard must dedupe within the
-- statement, not just against existing rows). Skipped rows keep working
-- exactly as before this migration; resolve any stragglers manually.
-- Invitations have no unique constraint on email, so they are lowercased
-- unconditionally.
UPDATE "claimnet"."users" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "claimnet"."users" d
    WHERE d."email" = lower(u."email") AND d."id" <> u."id"
  )
  AND u."id" = (
    SELECT w."id" FROM "claimnet"."users" w
    WHERE lower(w."email") = lower(u."email")
    ORDER BY w."created_at" ASC, w."id" ASC
    LIMIT 1
  );
--> statement-breakpoint
UPDATE "claimnet"."invitations"
SET "email" = lower("email")
WHERE "email" <> lower("email");
