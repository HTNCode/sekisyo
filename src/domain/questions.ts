import { z } from "zod";

export const QUESTION_CATEGORIES = [
  "boundary",
  "ripple",
  "alternatives",
  "failure",
  "performance",
  "custom"
] as const;

export const BUILT_IN_QUESTION_CATEGORIES = [
  "boundary",
  "ripple",
  "alternatives",
  "failure",
  "performance"
] as const;

export const QuestionCategorySchema = z.enum(QUESTION_CATEGORIES);

export type QuestionCategory = z.infer<typeof QuestionCategorySchema>;

export interface QuestionCategoryDefinition {
  readonly label: string;
  readonly learningObjective: string;
}

export const QUESTION_CATEGORY_TAXONOMY = {
  boundary: {
    label: "境界条件",
    learningObjective: "入力範囲と境界値で成立する振る舞いを説明できる"
  },
  ripple: {
    label: "波及影響",
    learningObjective: "変更が依存先、利用者、運用へ与える影響を説明できる"
  },
  alternatives: {
    label: "代替案",
    learningObjective: "採用案と代替案のトレードオフを説明できる"
  },
  failure: {
    label: "失敗時",
    learningObjective: "障害の検出、影響、復旧方法を説明できる"
  },
  performance: {
    label: "性能",
    learningObjective: "時間、メモリ、外部資源のコストを説明できる"
  },
  custom: {
    label: "カスタム",
    learningObjective: "プロジェクト固有の確認事項を説明できる"
  }
} as const satisfies Readonly<
  Record<QuestionCategory, QuestionCategoryDefinition>
>;

const questionTextSchema = z.string().trim().min(1).max(20_000);

export const QuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    category: QuestionCategorySchema,
    prompt: questionTextSchema,
    learningObjective: questionTextSchema,
    evidence: z.array(questionTextSchema).max(100),
    rubric: z.array(questionTextSchema).min(1).max(100)
  })
  .strict();

export type Question = z.infer<typeof QuestionSchema>;

export const AnswerJudgmentSchema = z
  .object({
    passed: z.boolean(),
    feedback: questionTextSchema,
    missingConcept: questionTextSchema.optional(),
    followUp: questionTextSchema.optional()
  })
  .strict();

export type AnswerJudgment = z.infer<typeof AnswerJudgmentSchema>;

export const QaExchangeSchema = z
  .object({
    question: QuestionSchema,
    answer: questionTextSchema,
    judgment: AnswerJudgmentSchema
  })
  .strict();

export type QaExchange = z.infer<typeof QaExchangeSchema>;

export const QaSummarySchema = z
  .object({
    intent: questionTextSchema,
    decisions: z.array(questionTextSchema).max(1_000),
    risks: z.array(questionTextSchema).max(1_000),
    verification: z.array(questionTextSchema).max(1_000),
    unresolved: z.array(questionTextSchema).max(1_000)
  })
  .strict();

export type QaSummary = z.infer<typeof QaSummarySchema>;
