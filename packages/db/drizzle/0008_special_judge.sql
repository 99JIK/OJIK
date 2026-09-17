ALTER TYPE "public"."checker_type" ADD VALUE 'special';--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "checker_source" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "checker_language" "language";