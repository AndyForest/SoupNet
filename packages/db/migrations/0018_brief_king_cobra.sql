-- F18 (security-audit-2026-04-09): formalize the invitations FKs that were
-- previously commented as aspirational in packages/db/src/schema/invitations.ts.
-- Any pre-migration orphans (rows whose inviter or group has since been
-- deleted) are cleaned out first so the constraint creation does not error.
DELETE FROM "claimnet"."invitations"
 WHERE "inviter_id" NOT IN (SELECT "id" FROM "claimnet"."users")
    OR "group_id" NOT IN (SELECT "id" FROM "claimnet"."groups");--> statement-breakpoint
ALTER TABLE "claimnet"."invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "claimnet"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."invitations" ADD CONSTRAINT "invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "claimnet"."groups"("id") ON DELETE cascade ON UPDATE no action;