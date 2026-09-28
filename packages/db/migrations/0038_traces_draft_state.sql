ALTER TABLE "claimnet"."traces" ADD COLUMN "draft_state" text;--> statement-breakpoint
ALTER TABLE "claimnet"."traces" ADD COLUMN "draft_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."traces" ADD COLUMN "draft_resolved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "claimnet"."traces" ADD COLUMN "draft_resolved_by_key_id" uuid;--> statement-breakpoint
CREATE INDEX "traces_unpublished_draft_idx" ON "claimnet"."traces" USING btree ("user_id") WHERE "claimnet"."traces"."draft_state" IS NOT NULL AND "claimnet"."traces"."draft_state" <> 'verified';