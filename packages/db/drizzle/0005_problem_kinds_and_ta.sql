CREATE TYPE "public"."problem_kind" AS ENUM('code', 'blank', 'answer');--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'ta' BEFORE 'manager';--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "kind" "problem_kind" DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "blank_template" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "blank_lines" integer[];--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "blank_language" "language";