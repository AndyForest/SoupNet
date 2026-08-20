ALTER TABLE "claimnet"."check_feedback" ALTER COLUMN "trace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD COLUMN "search_audit_id" uuid;--> statement-breakpoint
CREATE INDEX "traces_judgment_date_idx" ON "claimnet"."traces" USING btree ((COALESCE("decided_at", "created_at")));--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD CONSTRAINT "check_feedback_search_dedup_unique" UNIQUE("api_key_id","search_audit_id","content_hash");--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD CONSTRAINT "check_feedback_one_target" CHECK (("claimnet"."check_feedback"."trace_id" IS NULL) <> ("claimnet"."check_feedback"."search_audit_id" IS NULL));