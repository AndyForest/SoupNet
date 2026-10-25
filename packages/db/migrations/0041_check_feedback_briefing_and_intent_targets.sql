ALTER TABLE "claimnet"."check_feedback" DROP CONSTRAINT "check_feedback_one_target";--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD COLUMN "briefing_audit_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "check_feedback_intent_dedup_unique" ON "claimnet"."check_feedback" USING btree ("api_key_id","intent_id","content_hash") WHERE trace_id IS NULL AND search_audit_id IS NULL AND briefing_audit_id IS NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD CONSTRAINT "check_feedback_briefing_dedup_unique" UNIQUE("api_key_id","briefing_audit_id","content_hash");--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD CONSTRAINT "check_feedback_one_target" CHECK ((CASE WHEN "claimnet"."check_feedback"."trace_id" IS NULL THEN 0 ELSE 1 END
         + CASE WHEN "claimnet"."check_feedback"."search_audit_id" IS NULL THEN 0 ELSE 1 END
         + CASE WHEN "claimnet"."check_feedback"."briefing_audit_id" IS NULL THEN 0 ELSE 1 END) = 1
        OR ("claimnet"."check_feedback"."trace_id" IS NULL AND "claimnet"."check_feedback"."search_audit_id" IS NULL AND "claimnet"."check_feedback"."briefing_audit_id" IS NULL
            AND "claimnet"."check_feedback"."kind" = 'outcome' AND "claimnet"."check_feedback"."intent_id" IS NOT NULL));