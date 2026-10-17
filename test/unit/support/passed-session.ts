import {
  createSessionRecord,
  transitionSession,
  type CreateSessionInput,
  type SessionRecord
} from "../../../src/domain/session.ts";

const NOW = "2026-10-18T00:00:00.000Z";

export const DIGEST = "a".repeat(64);

export function bindingFor(
  overrides: Partial<CreateSessionInput> = {}
): CreateSessionInput {
  return {
    base: "1".repeat(40),
    diffDigest: DIGEST,
    head: "2".repeat(40),
    model: "gpt-5.6-sol",
    policyDigest: DIGEST,
    promptVersion: "test",
    ref: "refs/heads/feature@" + "0".repeat(40),
    remote: "origin",
    ...overrides
  };
}

/** 質問1問・回答1件・意図的と判断した指摘1件を持つ通過済みの記録。 */
export function passedSession(
  binding: CreateSessionInput,
  label: string
): SessionRecord {
  let session = createSessionRecord(binding, NOW);
  session = transitionSession(session, "analyzed", NOW, {
    analysis: {
      summary: `${label}の変更`,
      filesChanged: 1,
      attention: [
        {
          path: `src/${label}.ts`,
          classification: "must_read",
          reason: `${label}の理由`
        }
      ],
      findings: [
        {
          id: "f1",
          path: `src/${label}.ts`,
          severity: "warning",
          title: `${label}の指摘`,
          explanation: "説明"
        }
      ],
      risks: [`${label}のリスク`]
    }
  });
  session = transitionSession(session, "review_resolved", NOW, {
    reviewResolutions: [
      {
        findingId: "f1",
        action: "intentional",
        reason: `${label}では意図どおり`,
        resolvedAt: NOW
      }
    ]
  });
  session = transitionSession(session, "questioning", NOW, {
    questions: [
      {
        id: "q1",
        category: "boundary",
        prompt: `${label}の境界は?`,
        learningObjective: "境界を説明できる",
        evidence: [],
        rubric: ["境界を説明する"]
      }
    ]
  });
  return transitionSession(session, "passed", NOW, {
    attempts: [
      {
        questionId: "q1",
        answer: `${label}の回答`,
        passed: true,
        feedback: "具体的",
        attemptedAt: NOW
      }
    ]
  });
}
