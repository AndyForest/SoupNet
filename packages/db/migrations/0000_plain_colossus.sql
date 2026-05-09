CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA "claimnet";
--> statement-breakpoint
CREATE TABLE "claimnet"."traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"format_adherence_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"provider" text DEFAULT 'local' NOT NULL,
	"external_id" text,
	"role" text DEFAULT 'tenant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"is_personal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_user_unique" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."evidence_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."trace_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"stance" text NOT NULL,
	"api_key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."trace_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."reference_source_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_id" uuid NOT NULL,
	"url" text NOT NULL,
	"content_type" text NOT NULL,
	"cached_content" text,
	"s3_key" text,
	"fetch_strategy" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"key_prefix" text NOT NULL,
	"user_id" uuid NOT NULL,
	"group_ids" uuid[] NOT NULL,
	"label" text,
	"key_type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_node_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."embedding_chunk_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"embedding_source_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_chunk_strategies_source_strategy_unique" UNIQUE("embedding_source_id","strategy_id")
);
--> statement-breakpoint
CREATE TABLE "claimnet"."embedding_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"embedding_source_id" uuid NOT NULL,
	"chunk_strategy_id" uuid NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_hash" varchar(64) NOT NULL,
	"chunk_path" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."embedding_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"source_text" text,
	"artifact_category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimnet"."embedding_vectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"embedding_chunk_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"task_type" text NOT NULL,
	"vector_source" text DEFAULT 'server' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"vector" halfvec(3072),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_vectors_chunk_model_task_unique" UNIQUE("embedding_chunk_id","model_id","task_type")
);
--> statement-breakpoint
ALTER TABLE "claimnet"."organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "claimnet"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "claimnet"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "claimnet"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "claimnet"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."evidence_references" ADD CONSTRAINT "evidence_references_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "claimnet"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."evidence_references" ADD CONSTRAINT "evidence_references_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "claimnet"."references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_evidence" ADD CONSTRAINT "trace_evidence_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "claimnet"."traces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_evidence" ADD CONSTRAINT "trace_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "claimnet"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_references" ADD CONSTRAINT "trace_references_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "claimnet"."traces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."trace_references" ADD CONSTRAINT "trace_references_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "claimnet"."references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."reference_source_cache" ADD CONSTRAINT "reference_source_cache_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "claimnet"."references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."embedding_chunk_strategies" ADD CONSTRAINT "embedding_chunk_strategies_embedding_source_id_embedding_sources_id_fk" FOREIGN KEY ("embedding_source_id") REFERENCES "claimnet"."embedding_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."embedding_chunks" ADD CONSTRAINT "embedding_chunks_embedding_source_id_embedding_sources_id_fk" FOREIGN KEY ("embedding_source_id") REFERENCES "claimnet"."embedding_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."embedding_chunks" ADD CONSTRAINT "embedding_chunks_chunk_strategy_id_embedding_chunk_strategies_id_fk" FOREIGN KEY ("chunk_strategy_id") REFERENCES "claimnet"."embedding_chunk_strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claimnet"."embedding_vectors" ADD CONSTRAINT "embedding_vectors_embedding_chunk_id_embedding_chunks_id_fk" FOREIGN KEY ("embedding_chunk_id") REFERENCES "claimnet"."embedding_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "traces_user_id_idx" ON "claimnet"."traces" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "traces_group_id_idx" ON "claimnet"."traces" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "traces_created_at_idx" ON "claimnet"."traces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_provider_external_id_idx" ON "claimnet"."users" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "organizations_owner_id_idx" ON "claimnet"."organizations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "group_members_group_id_idx" ON "claimnet"."group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "claimnet"."group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_organization_id_idx" ON "claimnet"."groups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "evidence_references_evidence_id_idx" ON "claimnet"."evidence_references" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "evidence_references_reference_id_idx" ON "claimnet"."evidence_references" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "trace_evidence_trace_id_idx" ON "claimnet"."trace_evidence" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trace_evidence_evidence_id_idx" ON "claimnet"."trace_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "trace_references_trace_id_idx" ON "claimnet"."trace_references" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trace_references_reference_id_idx" ON "claimnet"."trace_references" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "claimnet"."api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_expires_at_idx" ON "claimnet"."api_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "claimnet"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_id_idx" ON "claimnet"."audit_log" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "claimnet"."audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "embedding_chunk_strategies_source_idx" ON "claimnet"."embedding_chunk_strategies" USING btree ("embedding_source_id");--> statement-breakpoint
CREATE INDEX "embedding_chunk_strategies_status_idx" ON "claimnet"."embedding_chunk_strategies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "embedding_chunks_source_idx" ON "claimnet"."embedding_chunks" USING btree ("embedding_source_id");--> statement-breakpoint
CREATE INDEX "embedding_chunks_strategy_idx" ON "claimnet"."embedding_chunks" USING btree ("chunk_strategy_id");--> statement-breakpoint
CREATE INDEX "embedding_chunks_hash_idx" ON "claimnet"."embedding_chunks" USING btree ("chunk_hash");--> statement-breakpoint
CREATE INDEX "embedding_sources_source_idx" ON "claimnet"."embedding_sources" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "embedding_sources_group_idx" ON "claimnet"."embedding_sources" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "embedding_vectors_status_idx" ON "claimnet"."embedding_vectors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "embedding_vectors_chunk_idx" ON "claimnet"."embedding_vectors" USING btree ("embedding_chunk_id");--> statement-breakpoint
CREATE INDEX "embedding_vectors_source_idx" ON "claimnet"."embedding_vectors" USING btree ("vector_source");--> statement-breakpoint
-- tsvector generated column for full-text search on traces
ALTER TABLE "claimnet"."traces" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "claim_text")) STORED;
CREATE INDEX "traces_tsv_idx" ON "claimnet"."traces" USING gin("tsv");
-- HNSW index for future vector similarity search
CREATE INDEX "embedding_vectors_hnsw_idx" ON "claimnet"."embedding_vectors" USING hnsw ("vector" halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);