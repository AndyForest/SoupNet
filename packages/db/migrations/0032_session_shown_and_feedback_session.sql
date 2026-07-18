CREATE TABLE "claimnet"."session_shown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"trace_id" uuid NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_shown_session_trace_unique" UNIQUE("session_id","trace_id")
);
--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "session_shown_session_id_shown_at_idx" ON "claimnet"."session_shown" USING btree ("session_id","shown_at" DESC NULLS LAST);