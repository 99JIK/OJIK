ALTER TYPE "public"."role" ADD VALUE 'instructor' BEFORE 'user';--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "owner_collection_id" integer;--> statement-breakpoint
CREATE INDEX "problems_owner_collection_idx" ON "problems" USING btree ("owner_collection_id") WHERE "problems"."owner_collection_id" IS NOT NULL;;--> statement-breakpoint
-- 외래키는 손으로 건다. problems.ts 에서 collections 를 import 하면 순환 참조가 된다
-- (collections.ts 가 problems 를 import 함). drizzle 스냅샷에는 이 제약이 안 남지만,
-- 스냅샷과 스키마를 비교하는 db:generate 는 DB 를 안 보므로 diff 가 생기지 않는다.
-- 컬렉션을 지우면 딸린 강의 전용 문제도 같이 지운다
ALTER TABLE "problems"
    ADD CONSTRAINT "problems_owner_collection_id_collections_id_fk"
    FOREIGN KEY ("owner_collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade;
