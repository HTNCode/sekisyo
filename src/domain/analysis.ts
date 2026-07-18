import { z } from "zod";

const repositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes("\0"), "Path must not contain NUL.");

const boundedTextSchema = z.string().trim().min(1).max(20_000);
const lineNumberSchema = z.number().int().positive();

export const AttentionClassificationSchema = z.enum([
  "mechanical",
  "routine",
  "must_read"
]);

export type AttentionClassification = z.infer<
  typeof AttentionClassificationSchema
>;

export const AttentionItemSchema = z
  .object({
    path: repositoryPathSchema,
    startLine: lineNumberSchema.optional(),
    endLine: lineNumberSchema.optional(),
    classification: AttentionClassificationSchema,
    reason: boundedTextSchema
  })
  .strict()
  .refine(
    (item) =>
      item.startLine === undefined ||
      item.endLine === undefined ||
      item.endLine >= item.startLine,
    {
      message: "endLine must be greater than or equal to startLine.",
      path: ["endLine"]
    }
  );

export type AttentionItem = z.infer<typeof AttentionItemSchema>;

export const ReviewFindingSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    path: repositoryPathSchema,
    line: lineNumberSchema.optional(),
    severity: z.enum(["blocking", "warning"]),
    title: z.string().trim().min(1).max(500),
    explanation: boundedTextSchema,
    suggestion: boundedTextSchema.optional()
  })
  .strict();

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const DiffAnalysisSchema = z
  .object({
    summary: boundedTextSchema,
    filesChanged: z.number().int().nonnegative().max(100_000),
    attention: z.array(AttentionItemSchema).max(100_000),
    findings: z.array(ReviewFindingSchema).max(10_000),
    risks: z.array(boundedTextSchema).max(1_000)
  })
  .strict();

export type DiffAnalysis = z.infer<typeof DiffAnalysisSchema>;
