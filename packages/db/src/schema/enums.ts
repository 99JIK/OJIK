import { pgEnum } from "drizzle-orm/pg-core";
import {
    ROLES,
    SUBMISSION_STATUSES,
    VERDICTS,
    LANGUAGE_IDS,
    CHECKER_TYPES,
    PROBLEM_KINDS,
    VISIBILITIES,
    COLLECTION_PRESETS,
    TIMINGS,
    REVEALS,
    SCORINGS,
    JOIN_POLICIES,
    ITEM_KINDS,
    MEMBER_ROLES,
    CONSENT_KINDS,
} from "@ojik/core";

// @ojik/core 의 상수를 그대로 PG enum 으로 만든다. 값이 갈릴 자리가 없다.
// KOJ 는 Go enum 과 sql/create_enum.psql 을 손으로 맞춰야 했고, AutoMigrate 가 enum 을
// 만들어 주지도 않아서 적용을 잊으면 조용히 깨졌다.
export const roleEnum = pgEnum("role", ROLES);
export const submissionStatusEnum = pgEnum("submission_status", SUBMISSION_STATUSES);
export const verdictEnum = pgEnum("verdict", VERDICTS);
export const languageEnum = pgEnum("language", LANGUAGE_IDS);
export const checkerTypeEnum = pgEnum("checker_type", CHECKER_TYPES);
export const problemKindEnum = pgEnum("problem_kind", PROBLEM_KINDS);

export const visibilityEnum = pgEnum("visibility", VISIBILITIES);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);

// 컬렉션의 정책 축들. 자세한 설명은 packages/core/src/collections.ts
export const collectionPresetEnum = pgEnum("collection_preset", COLLECTION_PRESETS);
export const timingEnum = pgEnum("timing", TIMINGS);
export const revealEnum = pgEnum("reveal", REVEALS);
export const scoringEnum = pgEnum("scoring", SCORINGS);
export const joinPolicyEnum = pgEnum("join_policy", JOIN_POLICIES);
export const itemKindEnum = pgEnum("item_kind", ITEM_KINDS);

export const consentKindEnum = pgEnum("consent_kind", CONSENT_KINDS);
