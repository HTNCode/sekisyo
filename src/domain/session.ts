import { z } from "zod";
import { DiffAnalysisSchema } from "./analysis.ts";
import {
  createSessionFingerprint,
  type SessionFingerprintInput
} from "./fingerprint.ts";
import { QaSummarySchema, QuestionSchema } from "./questions.ts";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const referenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes("\0") && !value.includes("\r") && !value.includes("\n"),
    "Reference must not contain control delimiters."
  );
const boundedTextSchema = z.string().trim().min(1).max(20_000);

export const SessionStatusSchema = z.enum([
  "initialized",
  "analyzed",
  "review_resolved",
  "questioning",
  "passed",
  "summarized",
  "published",
  "failed"
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionFreshness = "current" | "stale";

export const QuestionAttemptSchema = z
  .object({
    questionId: z.string().trim().min(1).max(200),
    answer: boundedTextSchema,
    passed: z.boolean(),
    feedback: boundedTextSchema,
    missingConcept: boundedTextSchema.optional(),
    attemptedAt: z.iso.datetime({ offset: true })
  })
  .strict();

export type QuestionAttempt = z.infer<typeof QuestionAttemptSchema>;

export const ReviewResolutionSchema = z
  .object({
    findingId: z.string().trim().min(1).max(200),
    action: z.literal("intentional"),
    reason: boundedTextSchema,
    resolvedAt: z.iso.datetime({ offset: true })
  })
  .strict();

export type ReviewResolution = z.infer<typeof ReviewResolutionSchema>;

export const SessionRecordSchema = z
  .object({
    version: z.literal(1),
    fingerprint: digestSchema,
    base: referenceSchema,
    head: referenceSchema,
    remote: referenceSchema,
    ref: referenceSchema,
    diffDigest: digestSchema,
    policyDigest: digestSchema,
    promptVersion: referenceSchema,
    model: referenceSchema,
    analysis: DiffAnalysisSchema.nullable(),
    questions: z.array(QuestionSchema).max(100),
    attempts: z.array(QuestionAttemptSchema).max(10_000),
    reviewResolutions: z.array(ReviewResolutionSchema).max(10_000),
    summary: QaSummarySchema.nullable(),
    status: SessionStatusSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()
  .superRefine((session, context) => {
    const expectedFingerprint = createSessionFingerprint(session);
    if (session.fingerprint !== expectedFingerprint) {
      context.addIssue({
        code: "custom",
        message: "Session fingerprint does not match its binding.",
        path: ["fingerprint"]
      });
    }
    if (
      session.status !== "initialized" &&
      session.status !== "failed" &&
      session.analysis === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Analyzed sessions must include their analysis.",
        path: ["analysis"]
      });
    }
  });

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export interface CreateSessionInput extends SessionFingerprintInput {
  readonly diffDigest: string;
}

const NEXT_STATUS: Readonly<
  Partial<Record<SessionStatus, readonly SessionStatus[]>>
> = {
  initialized: ["analyzed", "failed"],
  analyzed: ["review_resolved", "failed"],
  review_resolved: ["questioning", "failed"],
  questioning: ["passed", "failed"],
  passed: ["summarized", "failed"],
  summarized: ["published", "failed"]
};

export function createSessionRecord(
  input: CreateSessionInput,
  now: string
): SessionRecord {
  return SessionRecordSchema.parse({
    version: 1,
    fingerprint: createSessionFingerprint(input),
    base: input.base,
    head: input.head,
    remote: input.remote,
    ref: input.ref,
    diffDigest: input.diffDigest,
    policyDigest: input.policyDigest,
    promptVersion: input.promptVersion,
    model: input.model,
    analysis: null,
    questions: [],
    attempts: [],
    reviewResolutions: [],
    summary: null,
    status: "initialized",
    createdAt: now,
    updatedAt: now
  });
}

export function canTransitionSession(
  current: SessionStatus,
  next: SessionStatus
): boolean {
  return NEXT_STATUS[current]?.includes(next) ?? false;
}

export function transitionSession(
  session: SessionRecord,
  next: SessionStatus,
  now: string,
  changes: Partial<
    Pick<
      SessionRecord,
      "analysis" | "questions" | "attempts" | "reviewResolutions" | "summary"
    >
  > = {}
): SessionRecord {
  if (!canTransitionSession(session.status, next)) {
    throw new Error(
      `Invalid session transition: ${session.status} -> ${next}.`
    );
  }

  return SessionRecordSchema.parse({
    ...session,
    ...changes,
    status: next,
    updatedAt: now
  });
}

export function assessSessionFreshness(
  session: SessionRecord,
  binding: SessionFingerprintInput
): SessionFreshness {
  return session.fingerprint === createSessionFingerprint(binding)
    ? "current"
    : "stale";
}

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return status === "published" || status === "failed";
}
