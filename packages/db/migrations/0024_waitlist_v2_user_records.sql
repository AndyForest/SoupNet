DROP TABLE "claimnet"."waitlist" CASCADE;--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "waitlisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "signup_reason" text;