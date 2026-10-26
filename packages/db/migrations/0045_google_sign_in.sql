CREATE TABLE "claimnet"."sso_login_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"binding_hash" text NOT NULL,
	"return_kind" text NOT NULL,
	"return_params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" uuid,
	"session_idp" text,
	"handoff_hash" text,
	"handoff_expires_at" timestamp with time zone,
	"handoff_consumed_at" timestamp with time zone,
	CONSTRAINT "sso_login_requests_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "sso_login_requests_handoff_hash_unique" UNIQUE("handoff_hash"),
	CONSTRAINT "sso_login_requests_return_kind_check" CHECK ("claimnet"."sso_login_requests"."return_kind" IN ('app', 'oauth_authorize'))
);
--> statement-breakpoint
CREATE TABLE "claimnet"."user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"hosted_domain" text,
	"linked_via" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_issuer_subject_unique" UNIQUE("issuer","subject"),
	CONSTRAINT "user_identities_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "user_identities_provider_check" CHECK ("claimnet"."user_identities"."provider" IN ('google')),
	CONSTRAINT "user_identities_linked_via_check" CHECK ("claimnet"."user_identities"."linked_via" IN ('signup', 'email_match'))
);
--> statement-breakpoint
ALTER TABLE "claimnet"."users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."organizations" ADD COLUMN "require_sso" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."sso_login_requests" ADD CONSTRAINT "sso_login_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_login_requests_created_at_idx" ON "claimnet"."sso_login_requests" USING btree ("created_at");