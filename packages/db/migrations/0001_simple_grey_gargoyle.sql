ALTER TABLE "claimnet"."traces" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "claimnet"."traces" ADD COLUMN "claim_text_hash" text;--> statement-breakpoint
CREATE INDEX "traces_api_key_id_idx" ON "claimnet"."traces" USING btree ("api_key_id");--> statement-breakpoint
ALTER TABLE "claimnet"."traces" ADD CONSTRAINT "traces_api_key_group_claim_unique" UNIQUE("api_key_id","group_id","claim_text_hash");