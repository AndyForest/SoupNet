CREATE TABLE "claimnet"."organization_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"challenge_token" text NOT NULL,
	"token_issued_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_found_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"auto_join" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domains_org_domain_unique" UNIQUE("organization_id","domain"),
	CONSTRAINT "organization_domains_domain_lowercase" CHECK ("claimnet"."organization_domains"."domain" = lower("claimnet"."organization_domains"."domain"))
);
--> statement-breakpoint
ALTER TABLE "claimnet"."organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "claimnet"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_verified_domain_unique" ON "claimnet"."organization_domains" USING btree ("domain") WHERE "claimnet"."organization_domains"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_domains_domain_idx" ON "claimnet"."organization_domains" USING btree ("domain");