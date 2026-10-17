import type { QaModelSelection } from "../config/model.ts";
import type { AnalysisEngine } from "../domain/analysis-engine.ts";
import type { ReviewStrictness } from "../domain/strictness.ts";
import type { PhaseTimer } from "../observability/timing.ts";
import type { DiffAnalyzer } from "../ports/diff-analyzer.ts";
import { createClaudeCodeDiffAnalyzer } from "./claude-code/diff-analyzer.ts";
import { createCodexDiffAnalyzer } from "./codex/index.ts";
import { ApiDiffAnalyzer } from "./model/diff-analyzer.ts";
import { loadStructuredOutputClient } from "./model/factory.ts";

export interface CreateDiffAnalyzerOptions {
  readonly engine: AnalysisEngine;
  /** analysis.model。api エンジンで省略された場合は qaModel.model を使う。 */
  readonly model?: string;
  /** api エンジンが接続する provider。口頭試問と同じ提供元・資格情報を使う。 */
  readonly qaModel: QaModelSelection;
  readonly strictness: ReviewStrictness;
  readonly timeoutMs: number;
  readonly timer: PhaseTimer;
}

export function createDiffAnalyzer(
  options: CreateDiffAnalyzerOptions
): DiffAnalyzer {
  const cliOptions = {
    ...(options.model === undefined ? {} : { model: options.model }),
    strictness: options.strictness,
    timeoutMs: options.timeoutMs,
    timer: options.timer
  };
  switch (options.engine) {
    case "codex":
      return createCodexDiffAnalyzer(cliOptions);
    case "claude-code":
      return createClaudeCodeDiffAnalyzer(cliOptions);
    case "api":
      return new ApiDiffAnalyzer(
        () =>
          loadStructuredOutputClient(
            options.qaModel.provider,
            options.timeoutMs
          ),
        {
          model: options.model ?? options.qaModel.model,
          strictness: options.strictness,
          timeoutMs: options.timeoutMs,
          timer: options.timer
        }
      );
  }
}
