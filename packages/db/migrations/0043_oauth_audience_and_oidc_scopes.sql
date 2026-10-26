ALTER TABLE "claimnet"."api_keys" ADD COLUMN "oauth_resource" text;--> statement-breakpoint
ALTER TABLE "claimnet"."api_keys" ADD COLUMN "oauth_oidc_scopes" text[];--> statement-breakpoint
ALTER TABLE "claimnet"."oauth_authorization_codes" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "claimnet"."oauth_authorization_codes" ADD COLUMN "oidc_scopes" text[];