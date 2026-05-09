ALTER TABLE "claimnet"."group_members" ADD COLUMN "daily_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."group_members" ADD COLUMN "daily_write" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Grandfather existing memberships so current users' daily-link behavior
-- doesn't silently narrow on upgrade. New rows (post-migration) inherit
-- the column default of false, satisfying "new groups default to excluded"
-- per design-thinking.md §Configurable defaults for the "daily agent link"
-- buttons.
UPDATE "claimnet"."group_members" SET "daily_read" = true, "daily_write" = true;