CREATE TABLE "claimnet"."oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text NOT NULL,
	"client_name" text,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"scope_read_group_ids" uuid[] NOT NULL,
	"scope_write_group_ids" uuid[] NOT NULL,
	"scope_default_write_group_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "refresh_token_hash" text;--> statement-breakpoint
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "claimnet"."oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "api_keys_refresh_token_hash_idx" ON "claimnet"."api_keys" USING btree ("refresh_token_hash");