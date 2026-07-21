CREATE TABLE "claimnet"."ephemeral_books" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"created_by_key_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claimnet"."users" ADD COLUMN "personal_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "claimnet"."ephemeral_books" ADD CONSTRAINT "ephemeral_books_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "claimnet"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ephemeral_books_expires_at_idx" ON "claimnet"."ephemeral_books" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ephemeral_books_created_by_key_id_idx" ON "claimnet"."ephemeral_books" USING btree ("created_by_key_id");--> statement-breakpoint
-- Backfill personal_organization_id for existing users to their OLDEST owned
-- organization. Registration has always created the personal org first
-- (is_personal = true), so oldest-owned coincides with the personal org in the
-- normal case; the LATERAL picks one deterministically (created_at, then id as
-- tie-break) even for a user who owns several. Prefer an is_personal org when
-- one exists, else fall back to the oldest owned org — a user whose personal
-- org was somehow removed still gets a stable pointer. Runs at startup
-- (migrations apply on boot), so it must never fail the deploy: users with no
-- owned org are simply left NULL rather than aborting (corpus recipe c26fa597).
UPDATE "claimnet"."users" u
SET "personal_organization_id" = (
	SELECT o.id
	FROM "claimnet"."organizations" o
	WHERE o.owner_id = u.id
	ORDER BY o.is_personal DESC, o.created_at ASC, o.id ASC
	LIMIT 1
)
WHERE u."personal_organization_id" IS NULL
	AND EXISTS (SELECT 1 FROM "claimnet"."organizations" o2 WHERE o2.owner_id = u.id);