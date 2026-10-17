import { z } from "zod";

import type { ReviewStrictness } from "../../domain/strictness.ts";
import type { PhaseTimer } from "../../observability/timing.ts";
import type { ProcessResult } from "../../ports/process-runner.ts";
import { BunProcessRunner } from "../codex/bun-process-runner.ts";
import {
  type AnalysisCliDriver,
  type AnalysisCliRequest,
  CliDiffAnalyzer,
  createAllowlistedEnvironment,
  PLATFORM_ENVIRONMENT_NAMES
} from "../codex/diff-analyzer.ts";
import {
  AnalysisEngineError,
  type AnalysisEngineErrorOptions,
  type CodexAdapterErrorCode
} from "../codex/errors.ts";
import { NodeCodexTemporaryWorkspaceFactory } from "../codex/temporary-workspace.ts";

export const CLAUDE_CODE_ANALYSIS_PHASE = "claude-code-analysis";
const CLAUDE_CODE_EXECUTABLE = "claude";

// Claude Code が API へ到達し認証するのに要るものだけを足す。OpenAI や Gemini の
// キーは渡さない。プロキシ経由でしか外へ出られない環境では、プロキシ設定と社内 CA
// が無いと名前解決の段階で失敗する（サンドボックス内で ENOTFOUND を実測）。
const CLAUDE_CODE_ENVIRONMENT_ALLOWLIST: ReadonlySet<string> = new Set([
  ...PLATFORM_ENVIRONMENT_NAMES,
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "USER"
]);

/**
 * Claude Code の --json-schema は draft 2020-12 の "$schema" を解決できず起動時に
 * 失敗する（実測）。キーワード自体は互換なので、宣言だけを外して渡す。
 */
export function toClaudeCodeJsonSchema(schemaJson: string): string {
  const parsed = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(schemaJson));
  const { $schema: _declaration, ...schema } = parsed;
  return JSON.stringify(schema);
}

// `claude -p --output-format json` の結果。--json-schema を付けると、検証済みの
// 出力が structured_output に入る（2026-10-18 に実測）。
const claudeResultSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean(),
    structured_output: z.unknown().optional()
  })
  .passthrough();

export class ClaudeCodeAdapterError extends AnalysisEngineError {
  constructor(
    code: CodexAdapterErrorCode,
    options: AnalysisEngineErrorOptions = {}
  ) {
    super("Claude Code", code, options);
    this.name = "ClaudeCodeAdapterError";
  }
}

export function createClaudeCodeEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env
): Readonly<Record<string, string>> {
  return createAllowlistedEnvironment(
    CLAUDE_CODE_ENVIRONMENT_ALLOWLIST,
    source
  );
}

/** 標準出力の JSON から構造化出力だけを取り出す。 */
export function readClaudeCodeStructuredOutput(stdout: string): string {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stdout);
  } catch {
    throw new ClaudeCodeAdapterError("invalid_event_stream");
  }
  const result = claudeResultSchema.safeParse(candidate);
  if (!result.success) {
    throw new ClaudeCodeAdapterError("invalid_event_stream");
  }
  if (result.data.is_error || result.data.subtype !== "success") {
    throw new ClaudeCodeAdapterError("failed_event");
  }
  if (result.data.structured_output === undefined) {
    throw new ClaudeCodeAdapterError("missing_output");
  }
  return JSON.stringify(result.data.structured_output);
}

export class ClaudeCodeDriver implements AnalysisCliDriver {
  readonly engine = "Claude Code";
  readonly phase = CLAUDE_CODE_ANALYSIS_PHASE;
  readonly #executable: string;
  readonly #model: string | undefined;

  constructor(options: {
    readonly executable?: string;
    readonly model?: string;
  }) {
    this.#executable = options.executable ?? CLAUDE_CODE_EXECUTABLE;
    this.#model = options.model;
  }

  /**
   * Codex の --sandbox read-only / --ephemeral / --ignore-user-config に相当する
   * 指定。--restricted はコマンド実行系ツールを外し、ファイル操作を作業ディレクトリ
   * （サニタイズ済みのスナップショット）に閉じ、利用者・プロジェクトの設定を読まない。
   * 利用者の ~/.claude/CLAUDE.md が読まれないことも実測で確認している。
   */
  buildArguments({
    prompt,
    schemaJson
  }: AnalysisCliRequest): readonly string[] {
    return [
      this.#executable,
      "-p",
      "--restricted",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--permission-prompts",
      "none",
      "--tools",
      "Read,Grep,Glob",
      "--output-format",
      "json",
      "--json-schema",
      toClaudeCodeJsonSchema(schemaJson),
      ...(this.#model === undefined ? [] : ["--model", this.#model]),
      prompt
    ];
  }

  environment(): Readonly<Record<string, string>> {
    return createClaudeCodeEnvironment();
  }

  async readOutput(result: ProcessResult): Promise<string> {
    return readClaudeCodeStructuredOutput(result.stdout);
  }

  createError(
    code: CodexAdapterErrorCode,
    options?: AnalysisEngineErrorOptions
  ): AnalysisEngineError {
    return new ClaudeCodeAdapterError(code, options);
  }
}

export interface ClaudeCodeDiffAnalyzerOptions {
  readonly model?: string;
  readonly strictness?: ReviewStrictness;
  readonly timeoutMs?: number;
  readonly timer?: PhaseTimer;
}

export function createClaudeCodeDiffAnalyzer(
  options: ClaudeCodeDiffAnalyzerOptions = {}
): CliDiffAnalyzer {
  return new CliDiffAnalyzer(
    new ClaudeCodeDriver(
      options.model === undefined ? {} : { model: options.model }
    ),
    new BunProcessRunner(),
    new NodeCodexTemporaryWorkspaceFactory(),
    options
  );
}
