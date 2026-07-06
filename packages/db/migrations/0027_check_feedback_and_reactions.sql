CREATE TABLE "claimnet"."check_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"impact" text NOT NULL,
	"disposition" text NOT NULL,
	"story_fulfilled" text NOT NULL,
	"story" text NOT NULL,
	"note" text,
	"top_similarity" real,
	"model" text,
	"harness" text,
	"harness_version" text,
	"related_trace_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."check_feedback_stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_feedback_stars_feedback_user_unique" UNIQUE("feedback_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."trace_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trace_reactions_trace_user_unique" UNIQUE("trace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD CONSTRAINT "check_feedback_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "claimnet"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback_stars" ADD CONSTRAINT "check_feedback_stars_feedback_id_check_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "claimnet"."check_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback_stars" ADD CONSTRAINT "check_feedback_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_reactions" ADD CONSTRAINT "trace_reactions_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "claimnet"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_reactions" ADD CONSTRAINT "trace_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_feedback_trace_id_idx" ON "claimnet"."check_feedback" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "check_feedback_api_key_id_created_at_idx" ON "claimnet"."check_feedback" USING btree ("api_key_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "check_feedback_stars_feedback_id_idx" ON "claimnet"."check_feedback_stars" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "trace_reactions_trace_id_idx" ON "claimnet"."trace_reactions" USING btree ("trace_id");