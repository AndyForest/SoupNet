ALTER TABLE "claimnet"."references" ADD COLUMN "file_url" text;--> statement-breakpoint
ALTER TABLE "claimnet"."references" ADD COLUMN "file_mime_type" text;--> statement-breakpoint
ALTER TABLE "claimnet"."references" ADD COLUMN "file_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "claimnet"."evidence" DROP COLUMN "image_url";--> statement-breakpoint
ALTER TABLE "claimnet"."evidence" DROP COLUMN "image_mime_type";--> statement-breakpoint
ALTER TABLE "claimnet"."evidence" DROP COLUMN "image_hash";