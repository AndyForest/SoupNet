CREATE TABLE "claimnet"."organization_directory_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"domain" text NOT NULL,
	"domain_unicode" text NOT NULL,
	"admin_email" text NOT NULL,
	"service_account_email" text,
	"credential_ciphertext" text NOT NULL,
	"credential_iv" text NOT NULL,
	"credential_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	CONSTRAINT "organization_directory_connections_org_unique" UNIQUE("organization_id"),
	CONSTRAINT "organization_directory_connections_kind_check" CHECK ("claimnet"."organization_directory_connections"."kind" IN ('admin_consent', 'service_account'))
);
--> statement-breakpoint
ALTER TABLE "claimnet"."sso_login_requests" DROP CONSTRAINT "sso_login_requests_return_kind_check";--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD COLUMN "directory_status" text;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD COLUMN "directory_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD COLUMN "directory_check_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_directory_connections" ADD CONSTRAINT "organization_directory_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "claimnet"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD CONSTRAINT "organization_members_directory_status_check" CHECK ("claimnet"."organization_members"."directory_status" IS NULL OR "claimnet"."organization_members"."directory_status" IN ('active', 'suspended', 'archived', 'deleted'));--> statement-breakpoint
ALTER TABLE "claimnet"."sso_login_requests" ADD CONSTRAINT "sso_login_requests_return_kind_check" CHECK ("claimnet"."sso_login_requests"."return_kind" IN ('app', 'oauth_authorize', 'directory_connect'));