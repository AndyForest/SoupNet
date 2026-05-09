CREATE TABLE "claimnet"."vector_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"task_type" text NOT NULL,
	"vector" vector(3072) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vector_cache_hash_model_task_unique" UNIQUE("content_hash","model_id","task_type")
);
--> statement-breakpoint
CREATE INDEX "vector_cache_content_hash_idx" ON "claimnet"."vector_cache" USING btree ("content_hash");