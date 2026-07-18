import { z } from "zod";

const safeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes("\0"), "Value must not contain NUL.");

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
            prompt: safeTextSchema
          })
          .strict()
      )
      .max(100)
      .default([]),
    paths: z.record(safeTextSchema, PathQuestionOverridesSchema).default({})
  })
  .strict();

const AnalysisConfigSchema = z
  .object({
    maxChangedFiles: z.number().int().min(1).max(100_000).default(200),
    maxDiffBytes: z.number().int().min(1).max(100_000_000).default(1_000_000),
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

export const SekisyoConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    model: safeTextSchema.default("gpt-5.6-sol"),
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

export type SekisyoConfig = z.infer<typeof SekisyoConfigSchema>;
