CREATE TABLE "claimnet"."intent_shown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" text NOT NULL,
	"trace_id" uuid NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intent_shown_intent_trace_unique" UNIQUE("intent_id","trace_id")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."intents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"agent_id" text,
	"story" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claimnet"."check_feedback" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "claimnet"."intent_shown" ADD CONSTRAINT "intent_shown_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "claimnet"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_shown_intent_id_shown_at_idx" ON "claimnet"."intent_shown" USING btree ("intent_id","shown_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "intents_user_created_idx" ON "claimnet"."intents" USING btree ("user_id","created_at" DESC NULLS LAST);