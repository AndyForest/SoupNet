ALTER TABLE "claimnet"."users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "suspended_reason" text;