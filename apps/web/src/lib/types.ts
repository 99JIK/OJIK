import type { Verdict, SubmissionStatus, LanguageId, EditorMode, ProblemKind } from "@ojik/core";

export interface PublicUser {
    id: number;
    handle: string;
    displayName: string | null;
    role: "admin" | "staff" | "user";
    solvedCount: number;
    submissionCount: number;
}

export interface ProblemSummary {
    id: number;
    kind: ProblemKind;
    /** 출제자 아이디. 계정이 지워졌으면 null */
    authorHandle: string | null;
    title: string;
    timeLimitMs: number;
    memoryLimitMb: number;
    difficulty: number | null;
    acceptedCount: number;
    submissionCount: number;
    isPublic: boolean;
}

export interface ProblemDetail extends ProblemSummary {
    statement: string;
    inputDesc: string;
    outputDesc: string;
    hint: string | null;
    checkerType: "exact" | "trim" | "float";
}

export interface Sample {
    idx: number;
    input: string;
    output: string;
}

export interface SubmissionRow {
    id: number;
    problemId: number;
    problemTitle: string;
    userId: number;
    handle: string;
    language: LanguageId;
    status: SubmissionStatus;
    verdict: Verdict | null;
    score: number;
    maxTimeMs: number | null;
    maxMemoryKb: number | null;
    judgedCount: number;
    totalCount: number;
    sourceBytes: number;
    createdAt: string;
}

export interface LanguageOption {
    id: LanguageId;
    label: string;
    extension: string;
    editorMode: EditorMode;
}
