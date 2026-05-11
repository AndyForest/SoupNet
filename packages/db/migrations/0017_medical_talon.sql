ALTER TABLE "claimnet"."audit_log" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_api_key_id_occurred_at_idx" ON "claimnet"."audit_log" USING btree ("api_key_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
-- F29 backfill: existing recipe.checked rows already carry the api key id in
-- metadata.apiKeyId. Promote it to the new column so the per-key rate-limit
-- COUNT queries (introduced in this migration's middleware change) include
-- pre-migration history. Cast guards against rows where the metadata key is
-- missing or not a uuid string.
UPDATE "claimnet"."audit_log"
   SET "api_key_id" = ("metadata"->>'apiKeyId')::uuid
 WHERE "api_key_id" IS NULL
   AND "metadata" ? 'apiKeyId'
   AND ("metadata"->>'apiKeyId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';