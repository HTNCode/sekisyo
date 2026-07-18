import type { DiffAnalysis } from "../domain/analysis.ts";

export type ReviewTarget =
  | { readonly kind: "base"; readonly baseRef: string }
  | { readonly kind: "commit"; readonly commit: string }
  | { readonly kind: "uncommitted" };

export interface DiffAnalysisInput {
  readonly diff: string;
  readonly excludedPaths?: readonly string[];
  readonly head: string;
  readonly repositoryPath: string;
  readonly target: ReviewTarget;
}

export interface DiffAnalyzer {
  analyze(
    input: DiffAnalysisInput,
    signal?: AbortSignal
  ): Promise<DiffAnalysis>;
}
