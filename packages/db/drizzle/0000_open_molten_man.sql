CREATE TYPE "public"."checker_type" AS ENUM('exact', 'trim', 'float');--> statement-breakpoint
CREATE TYPE "public"."collection_preset" AS ENUM('course', 'problemset', 'contest', 'exam');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('research');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('problem', 'text');--> statement-breakpoint
CREATE TYPE "public"."join_policy" AS ENUM('open', 'members', 'register', 'invite');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('c', 'cpp', 'python3', 'java');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('member', 'manager');--> statement-breakpoint
CREATE TYPE "public"."reveal" AS ENUM('immediate', 'frozen', 'after_end');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'staff', 'user');--> statement-breakpoint
CREATE TYPE "public"."scoring" AS ENUM('none', 'progress', 'icpc', 'ioi');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('queued', 'judging', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."timing" AS ENUM('none', 'fixed', 'per_user');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'output_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TABLE "user_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" "role" DEFAULT 'user' NOT NULL,
	"solved_count" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "problem_tags" (
	"problem_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "problem_tags_problem_id_tag_id_pk" PRIMARY KEY("problem_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"statement" text DEFAULT '' NOT NULL,
	"input_desc" text DEFAULT '' NOT NULL,
	"output_desc" text DEFAULT '' NOT NULL,
	"hint" text,
	"time_limit_ms" integer DEFAULT 1000 NOT NULL,
	"memory_limit_mb" integer DEFAULT 256 NOT NULL,
	"checker_type" "checker_type" DEFAULT 'trim' NOT NULL,
	"float_epsilon" double precision DEFAULT 0.000001 NOT NULL,
	"stop_on_first_fail" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_from" timestamp with time zone,
	"difficulty" integer,
	"testcase_version" integer DEFAULT 1 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "testcases" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" integer NOT NULL,
	"idx" integer NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"input_sha256" text NOT NULL,
	"input_bytes" integer NOT NULL,
	"output_sha256" text NOT NULL,
	"output_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"testcase_id" integer,
	"idx" integer NOT NULL,
	"verdict" "verdict" NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"memory_kb" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"collection_id" integer,
	"language" "language" NOT NULL,
	"source_code" text NOT NULL,
	"source_bytes" integer NOT NULL,
	"status" "submission_status" DEFAULT 'queued' NOT NULL,
	"verdict" "verdict",
	"score" integer DEFAULT 0 NOT NULL,
	"max_time_ms" integer,
	"max_memory_kb" integer,
	"judged_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"compile_output" text,
	"judge_error" text,
	"failed_idx" integer,
	"failed_stdout" text,
	"failed_stderr" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"judge_env_id" integer,
	"testcase_version" integer,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_code_public" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"idx" integer NOT NULL,
	"kind" "item_kind" DEFAULT 'problem' NOT NULL,
	"problem_id" integer,
	"points" integer DEFAULT 100 NOT NULL,
	"body" text,
	"heading" text
);
--> statement-breakpoint
CREATE TABLE "collection_members" (
	"collection_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_members_collection_id_user_id_pk" PRIMARY KEY("collection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"preset" "collection_preset" DEFAULT 'problemset' NOT NULL,
	"timing" "timing" DEFAULT 'none' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"duration_minutes" integer,
	"reveal" "reveal" DEFAULT 'immediate' NOT NULL,
	"freeze_minutes" integer DEFAULT 0 NOT NULL,
	"scoring" "scoring" DEFAULT 'none' NOT NULL,
	"penalty_minutes" integer DEFAULT 20 NOT NULL,
	"join_policy" "join_policy" DEFAULT 'open' NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judge_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"busy" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "judge_environments" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"worker_id" text NOT NULL,
	"hostname" text NOT NULL,
	"arch" text NOT NULL,
	"runner_images" text NOT NULL,
	"isolate_version" text DEFAULT '' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_emails" ADD CONSTRAINT "user_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testcases" ADD CONSTRAINT "testcases_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_testcase_id_testcases_id_fk" FOREIGN KEY ("testcase_id") REFERENCES "public"."testcases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_judge_env_id_judge_environments_id_fk" FOREIGN KEY ("judge_env_id") REFERENCES "public"."judge_environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_emails_lower_idx" ON "user_emails" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "user_emails_user_idx" ON "user_emails" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_lower_idx" ON "users" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "users_solved_idx" ON "users" USING btree ("solved_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "problem_tags_tag_idx" ON "problem_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "problems_public_idx" ON "problems" USING btree ("is_public","id");--> statement-breakpoint
CREATE INDEX "problems_difficulty_idx" ON "problems" USING btree ("difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_idx" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "testcases_problem_idx_idx" ON "testcases" USING btree ("problem_id","idx");--> statement-breakpoint
CREATE INDEX "submission_results_submission_idx" ON "submission_results" USING btree ("submission_id","idx");--> statement-breakpoint
CREATE INDEX "submissions_queue_idx" ON "submissions" USING btree ("priority" DESC NULLS LAST,"id") WHERE "submissions"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "submissions_lease_idx" ON "submissions" USING btree ("heartbeat_at") WHERE "submissions"."status" = 'judging';--> statement-breakpoint
CREATE INDEX "submissions_user_idx" ON "submissions" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_problem_idx" ON "submissions" USING btree ("problem_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_collection_idx" ON "submissions" USING btree ("collection_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_ac_idx" ON "submissions" USING btree ("problem_id","user_id") WHERE "submissions"."verdict" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_idx_idx" ON "collection_items" USING btree ("collection_id","idx");--> statement-breakpoint
CREATE INDEX "collection_items_problem_idx" ON "collection_items" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "collection_members_user_idx" ON "collection_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_preset_idx" ON "collections" USING btree ("preset","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collections_time_idx" ON "collections" USING btree ("starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "judge_workers_seen_idx" ON "judge_workers" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "judge_environments_fp_idx" ON "judge_environments" USING btree ("fingerprint");