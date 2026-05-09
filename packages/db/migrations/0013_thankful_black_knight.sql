CREATE TABLE "claimnet"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "uploads_api_key_id_idx" ON "claimnet"."uploads" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "uploads_content_hash_idx" ON "claimnet"."uploads" USING btree ("content_hash");