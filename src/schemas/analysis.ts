import { z } from "zod";

import type {
  AttentionItem,
  DiffAnalysis,
  ReviewFinding
} from "../domain/analysis.ts";

export const attentionClassificationSchema = z.enum([
  "mechanical",
  "routine",
  "must_read"
]);

export const attentionItemWireSchema = z
  .object({
    path: z.string().min(1).max(1_024),
    startLine: z.number().int().positive().nullable(),
    endLine: z.number().int().positive().nullable(),
    classification: attentionClassificationSchema,
    reason: z.string().min(1).max(2_000)
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.startLine !== null &&
      item.endLine !== null &&
      item.endLine < item.startLine
    ) {
      context.addIssue({
        code: "custom",
        message: "endLine must be greater than or equal to startLine",
        path: ["endLine"]
      });
    }
  });

export const reviewFindingWireSchema = z
  .object({
    id: z.string().min(1).max(128),
    path: z.string().min(1).max(1_024),
    line: z.number().int().positive().nullable(),
    severity: z.enum(["blocking", "warning"]),
    title: z.string().min(1).max(300),
    explanation: z.string().min(1).max(3_000),
    suggestion: z.string().min(1).max(3_000).nullable()
  })
  .strict();

export const diffAnalysisWireSchema = z
  .object({
    summary: z.string().min(1).max(5_000),
    filesChanged: z.number().int().nonnegative().max(100_000),
    attention: z.array(attentionItemWireSchema).max(10_000),
    findings: z.array(reviewFindingWireSchema).max(2_000),
    risks: z.array(z.string().min(1).max(2_000)).max(200)
  })
  .strict();

export type AttentionItemWire = z.infer<typeof attentionItemWireSchema>;
export type DiffAnalysisWire = z.infer<typeof diffAnalysisWireSchema>;
export type ReviewFindingWire = z.infer<typeof reviewFindingWireSchema>;

function toAttentionItem(item: AttentionItemWire): AttentionItem {
  return {
    path: item.path,
    classification: item.classification,
    reason: item.reason,
    ...(item.startLine === null ? {} : { startLine: item.startLine }),
    ...(item.endLine === null ? {} : { endLine: item.endLine })
  };
}

function toReviewFinding(finding: ReviewFindingWire): ReviewFinding {
  return {
    id: finding.id,
    path: finding.path,
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    ...(finding.line === null ? {} : { line: finding.line }),
    ...(finding.suggestion === null ? {} : { suggestion: finding.suggestion })
  };
}

export function toDiffAnalysis(analysis: DiffAnalysisWire): DiffAnalysis {
  return {
    summary: analysis.summary,
    filesChanged: analysis.filesChanged,
    attention: analysis.attention.map(toAttentionItem),
    findings: analysis.findings.map(toReviewFinding),
    risks: analysis.risks
  };
}
