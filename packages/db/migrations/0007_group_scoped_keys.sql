-- Add read/write group separation to api_keys
-- Replaces flat group_ids[] with read_group_ids[], write_group_ids[], default_write_group_id
--
-- HISTORICAL NOTE (2026-04-09):
-- This migration was hand-written from scratch rather than generated via
-- `drizzle-kit generate`. Because it was written by hand, the corresponding
-- 0007_snapshot.json had to be hand-updated to reflect the new columns — and
-- whoever did that forgot to update the snapshot's `id`/`prevId` UUIDs,
-- creating a chain collision with 0006_snapshot.json. This was repaired in
-- 2026-04-09 by assigning a fresh UUID to 0007_snapshot.json and chaining it
-- to 0006's id.
--
-- DO NOT regenerate this migration. The schema state it produces matches what
-- 0007_snapshot.json reflects.
--
-- GOING FORWARD: For schema changes that need a backfill (like this one), run
-- `drizzle-kit generate` FIRST to get the structural ALTER TABLE statements
-- plus a correct snapshot. Then edit the generated .sql file to add backfill
-- UPDATE statements between the column-add and column-drop. The snapshot
-- tracks structure only, not data — adding UPDATE statements to a generated
-- migration is safe and idiomatic. The mistake here was hand-writing the
-- entire file from scratch, which forced a hand-update of the snapshot.
--
-- See: docs/engineering-principles.md §8 Never Make Direct Database Edits

-- Step 1: Add new columns (nullable initially for backfill)
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "read_group_ids" uuid[];
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "write_group_ids" uuid[];
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "default_write_group_id" uuid;

-- Step 2: Backfill from existing group_ids
UPDATE "claimnet"."api_keys"
SET
  read_group_ids = group_ids,
  write_group_ids = group_ids,
  default_write_group_id = group_ids[1];  -- Postgres arrays are 1-indexed

-- Step 3: Set NOT NULL constraints
ALTER TABLE "claimnet"."api_keys" ALTER COLUMN "read_group_ids" SET NOT NULL;
ALTER TABLE "claimnet"."api_keys" ALTER COLUMN "write_group_ids" SET NOT NULL;
ALTER TABLE "claimnet"."api_keys" ALTER COLUMN "default_write_group_id" SET NOT NULL;

-- Step 4: Drop old column
ALTER TABLE "claimnet"."api_keys" DROP COLUMN "group_ids";
