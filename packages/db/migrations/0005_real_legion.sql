CREATE TABLE "claimnet"."system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"bypass_cap" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "email_verification_token" text;--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "claimnet"."invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_group_id_idx" ON "claimnet"."invitations" USING btree ("group_id");