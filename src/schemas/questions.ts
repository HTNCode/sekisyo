import { z } from "zod";

import type {
  AnswerJudgment,
  QaSummary,
  Question
} from "../domain/questions.ts";

export const questionCategorySchema = z.enum([
  "boundary",
  "ripple",
  "alternatives",
  "failure",
  "performance",
  "custom"
]);

export const questionWireSchema = z
  .object({
    id: z.string().min(1).max(128),
    category: questionCategorySchema,
    prompt: z.string().min(1).max(2_000),
    learningObjective: z.string().min(1).max(1_000),
    evidence: z.array(z.string().min(1).max(1_000)).min(1).max(8),
    rubric: z.array(z.string().min(1).max(1_000)).min(1).max(8)
  })
  .strict();

export const questionListWireSchema = z
  .object({
    questions: z.array(questionWireSchema).min(1).max(20)
  })
  .strict();

export const answerJudgmentWireSchema = z
  .object({
    passed: z.boolean(),
    feedback: z.string().min(1).max(2_000),
    missingConcept: z.string().min(1).max(1_000).nullable(),
    followUp: z.string().min(1).max(2_000).nullable()
  })
  .strict();

export const followUpQuestionWireSchema = z
  .object({
    followUp: questionWireSchema.nullable()
  })
  .strict();

export const qaSummaryWireSchema = z
  .object({
    intent: z.string().min(1).max(3_000),
    decisions: z.array(z.string().min(1).max(2_000)).max(100),
    risks: z.array(z.string().min(1).max(2_000)).max(100),
    verification: z.array(z.string().min(1).max(2_000)).max(100),
    unresolved: z.array(z.string().min(1).max(2_000)).max(100)
  })
  .strict();

export type AnswerJudgmentWire = z.infer<typeof answerJudgmentWireSchema>;
export type QaSummaryWire = z.infer<typeof qaSummaryWireSchema>;
export type QuestionWire = z.infer<typeof questionWireSchema>;

export function toQuestion(question: QuestionWire): Question {
  return {
    id: question.id,
    category: question.category,
    prompt: question.prompt,
    learningObjective: question.learningObjective,
    evidence: question.evidence,
    rubric: question.rubric
  };
}

export function toAnswerJudgment(judgment: AnswerJudgmentWire): AnswerJudgment {
  return {
    passed: judgment.passed,
    feedback: judgment.feedback,
    ...(judgment.missingConcept === null
      ? {}
      : { missingConcept: judgment.missingConcept }),
    ...(judgment.followUp === null ? {} : { followUp: judgment.followUp })
  };
}

export function toQaSummary(summary: QaSummaryWire): QaSummary {
  return {
    intent: summary.intent,
    decisions: summary.decisions,
    risks: summary.risks,
    verification: summary.verification,
    unresolved: summary.unresolved
  };
}
