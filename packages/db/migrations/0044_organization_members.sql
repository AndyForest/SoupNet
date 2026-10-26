CREATE TABLE "claimnet"."organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_via" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_user_unique" UNIQUE("user_id"),
	CONSTRAINT "organization_members_role_check" CHECK ("claimnet"."organization_members"."role" IN ('owner', 'admin', 'member')),
	CONSTRAINT "organization_members_joined_via_check" CHECK ("claimnet"."organization_members"."joined_via" IN ('created', 'operator', 'domain', 'migrated'))
);
--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "sessions_valid_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claimnet"."organizations" ADD COLUMN "seat_limit" integer;--> statement-breakpoint
ALTER TABLE "claimnet"."group_members" ADD COLUMN "via" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."groups" ADD COLUMN "org_wide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."groups" ADD COLUMN "org_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "claimnet"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_organization_id_idx" ON "claimnet"."organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_org_default_idx" ON "claimnet"."groups" USING btree ("organization_id") WHERE "claimnet"."groups"."org_default";--> statement-breakpoint
ALTER TABLE "claimnet"."group_members" ADD CONSTRAINT "group_members_via_check" CHECK ("claimnet"."group_members"."via" IN ('direct', 'org'));--> statement-breakpoint
ALTER TABLE "claimnet"."groups" ADD CONSTRAINT "groups_org_default_is_org_wide" CHECK (NOT "claimnet"."groups"."org_default" OR "claimnet"."groups"."org_wide");