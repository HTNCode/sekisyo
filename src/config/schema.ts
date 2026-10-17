import { z } from "zod";

import { ANALYSIS_ENGINES } from "../domain/analysis-engine.ts";
import { BUILT_IN_QUESTION_CATEGORIES } from "../domain/questions.ts";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_QA_MODEL_PROVIDER,
  QA_MODEL_PROVIDERS,
  type QaModelProvider
} from "../domain/qa-model-provider.ts";
import {
  DEFAULT_REVIEW_STRICTNESS,
  REVIEW_STRICTNESS_LEVELS
} from "../domain/strictness.ts";

const safeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes("\0"), "Value must not contain NUL.");

// analysis.model becomes a CLI argv value (Codex or Claude Code), so it is
// restricted to a plain model identifier: no whitespace, control characters,
// or leading "-" that the CLI would read as another flag.
const modelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u,
    "Model must be a plain model identifier."
  );

const categorySettingSchema = z.union([z.boolean(), z.literal("required")]);

const categoryFlagsShape = {
  boundary: categorySettingSchema,
  ripple: categorySettingSchema,
  alternatives: categorySettingSchema,
  failure: categorySettingSchema,
  performance: categorySettingSchema
} as const;

export const QuestionCategoryFlagsSchema = z
  .object(categoryFlagsShape)
  .strict();

export const PathQuestionOverridesSchema = z
  .object({
    categories: z
      .object({
        boundary: categorySettingSchema.optional(),
        ripple: categorySettingSchema.optional(),
        alternatives: categorySettingSchema.optional(),
        failure: categorySettingSchema.optional(),
        performance: categorySettingSchema.optional()
      })
      .strict()
  })
  .strict();

const defaultCategoryFlags = {
  boundary: true,
  ripple: true,
  alternatives: true,
  failure: true,
  performance: false
};

const QuestionsConfigSchema = z
  .object({
    count: z.number().int().min(1).max(20).default(3),
    maxFollowUps: z.number().int().min(0).max(10).default(2),
    categories: QuestionCategoryFlagsSchema.default(defaultCategoryFlags),
    custom: z
      .array(
        z
          .object({
            name: safeTextSchema,
            prompt: safeTextSchema,
            required: z.boolean().optional()
          })
          .strict()
      )
      .max(100)
      .default([]),
    paths: z.record(safeTextSchema, PathQuestionOverridesSchema).default({})
  })
  .strict()
  .superRefine((questions, context) => {
    // Question routing tells built-in and custom categories apart by name, so a
    // duplicate custom name would be counted twice as required, and a custom
    // name equal to a built-in one would re-enable that built-in category.
    const builtInNames = new Set<string>(BUILT_IN_QUESTION_CATEGORIES);
    const seenNames = new Set<string>();
    for (const [index, category] of questions.custom.entries()) {
      if (builtInNames.has(category.name)) {
        context.addIssue({
          code: "custom",
          message: `Custom question name "${category.name}" is reserved for a built-in category.`,
          path: ["custom", index, "name"]
        });
      } else if (seenNames.has(category.name)) {
        context.addIssue({
          code: "custom",
          message: `Custom question name "${category.name}" must be unique.`,
          path: ["custom", index, "name"]
        });
      }
      seenNames.add(category.name);
    }
  });

const AnalysisConfigSchema = z
  .object({
    maxChangedFiles: z.number().int().min(1).max(100_000).default(200),
    maxDiffBytes: z.number().int().min(1).max(100_000_000).default(1_000_000),
    // Diff analysis engine. Optional with no default so an existing
    // .sekisyo.yml keeps its policy digest; absent means codex.
    engine: z.enum(ANALYSIS_ENGINES).optional(),
    // Analysis model. For codex and claude-code it becomes the CLI's --model;
    // for api it is the model name at the oral-examination provider, falling
    // back to the top-level model. Left optional so an existing .sekisyo.yml
    // keeps its policy digest and the engine's default when the key is absent.
    model: modelNameSchema.optional(),
    timeoutSeconds: z.number().int().min(1).max(3_600).default(180)
  })
  .strict();

const PrivacyConfigSchema = z
  .object({
    exclude: z
      .array(safeTextSchema)
      .max(1_000)
      .default(["**/.env*", "**/secrets/**", "**/*.pem", "**/*.key"])
  })
  .strict();

const OBJECT_INPUT = z.record(z.string(), z.unknown());

/**
 * provider を OpenAI 以外にして model を省いた設定に、OpenAI の既定モデル名が
 * 入らないようにする。既定を持たない provider では model の明示を求める。
 */
function applyProviderModelDefault(
  value: unknown,
  context: z.RefinementCtx
): unknown {
  const input = OBJECT_INPUT.safeParse(value);
  if (!input.success || input.data.model !== undefined) {
    return value;
  }
  const provider = input.data.provider;
  if (
    typeof provider !== "string" ||
    provider === DEFAULT_QA_MODEL_PROVIDER ||
    !(QA_MODEL_PROVIDERS as readonly string[]).includes(provider)
  ) {
    return value;
  }
  const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider as QaModelProvider];
  if (defaultModel === undefined) {
    context.addIssue({
      code: "custom",
      message: `provider: ${provider} では model を指定してください。`,
      path: ["model"]
    });
    return value;
  }
  return { ...input.data, model: defaultModel };
}

const SekisyoConfigObjectSchema = z
  .object({
    version: z.literal(1).default(1),
    // provider は省略時 openai。既存の .sekisyo.yml の policy digest を変えないよう
    // 既定値は持たせず、未指定ならキー自体を出力に含めない。
    provider: z.enum(QA_MODEL_PROVIDERS).optional(),
    model: safeTextSchema.default("gpt-5.6-sol"),
    strictness: z
      .enum(REVIEW_STRICTNESS_LEVELS)
      .default(DEFAULT_REVIEW_STRICTNESS),
    questions: QuestionsConfigSchema.default({
      count: 3,
      maxFollowUps: 2,
      categories: defaultCategoryFlags,
      custom: [],
      paths: {}
    }),
    analysis: AnalysisConfigSchema.default({
      maxChangedFiles: 200,
      maxDiffBytes: 1_000_000,
      timeoutSeconds: 180
    }),
    privacy: PrivacyConfigSchema.default({
      exclude: ["**/.env*", "**/secrets/**", "**/*.pem", "**/*.key"]
    })
  })
  .strict()
  .superRefine((config, context) => {
    const hasBuiltInCategory = Object.values(config.questions.categories).some(
      (setting) => setting !== false
    );
    if (!hasBuiltInCategory && config.questions.custom.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Enable a question category or configure a custom question.",
        path: ["questions", "categories"]
      });
    }
  });

export const SekisyoConfigSchema = z.preprocess(
  applyProviderModelDefault,
  SekisyoConfigObjectSchema
);

export type SekisyoConfig = z.infer<typeof SekisyoConfigSchema>;
