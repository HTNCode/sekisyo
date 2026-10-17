export const ANALYSIS_ENGINES = ["codex", "claude-code", "api"] as const;

export type AnalysisEngine = (typeof ANALYSIS_ENGINES)[number];

export const DEFAULT_ANALYSIS_ENGINE: AnalysisEngine = "codex";
