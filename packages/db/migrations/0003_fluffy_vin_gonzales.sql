ALTER TABLE "claimnet"."evidence" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "claimnet"."evidence" ADD COLUMN "image_mime_type" text;--> statement-breakpoint
ALTER TABLE "claimnet"."evidence" ADD COLUMN "image_hash" varchar(64);