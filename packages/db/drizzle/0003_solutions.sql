CREATE TABLE "solution_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"solution_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solution_comments" ADD CONSTRAINT "solution_comments_solution_id_solutions_id_fk" FOREIGN KEY ("solution_id") REFERENCES "public"."solutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_comments" ADD CONSTRAINT "solution_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solution_comments_solution_idx" ON "solution_comments" USING btree ("solution_id","id");--> statement-breakpoint
CREATE INDEX "solution_comments_user_day_idx" ON "solution_comments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "solutions_problem_idx" ON "solutions" USING btree ("problem_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "solutions_user_day_idx" ON "solutions" USING btree ("user_id","created_at");