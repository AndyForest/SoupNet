CREATE TABLE "claimnet"."email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claimnet"."invitations" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."waitlist" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "email_log_created_at_idx" ON "claimnet"."email_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_to_email_idx" ON "claimnet"."email_log" USING btree ("to_email");