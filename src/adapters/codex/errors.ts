export type CodexAdapterErrorCode =
  | "aborted"
  | "failed_event"
  | "filesystem"
  | "invalid_event_stream"
  | "invalid_input"
  | "invalid_output"
  | "missing_output"
  | "non_zero_exit"
  | "not_installed"
  | "repository_preparation"
  | "timeout"
  | "unknown";

// 利用者に表示されるため、解析エンジンの出力や差分本文は含めない。
function safeMessage(engine: string, code: CodexAdapterErrorCode): string {
  switch (code) {
    case "aborted":
      return `The ${engine} analysis was cancelled.`;
    case "failed_event":
      return `${engine} reported that the analysis failed.`;
    case "filesystem":
      return `The temporary ${engine} workspace could not be managed.`;
    case "invalid_event_stream":
      return `${engine} returned an invalid event stream.`;
    case "invalid_input":
      return `The ${engine} adapter received invalid input.`;
    case "invalid_output":
      return `${engine} returned invalid structured output.`;
    case "missing_output":
      return `${engine} did not create the structured output file.`;
    case "non_zero_exit":
      return `${engine} exited without completing the analysis.`;
    case "not_installed":
      return `The ${engine} executable could not be started.`;
    case "repository_preparation":
      return `The clean repository snapshot for ${engine} could not be prepared.`;
    case "timeout":
      return `The ${engine} analysis timed out.`;
    case "unknown":
      return `The ${engine} analysis failed.`;
  }
}

export interface AnalysisEngineErrorOptions {
  readonly exitCode?: number;
  readonly retryable?: boolean;
}

/** 差分解析エンジン共通のエラー。どのエンジンの失敗かを engine で示す。 */
export class AnalysisEngineError extends Error {
  readonly code: CodexAdapterErrorCode;
  readonly engine: string;
  readonly exitCode: number | undefined;
  readonly retryable: boolean;

  constructor(
    engine: string,
    code: CodexAdapterErrorCode,
    options: AnalysisEngineErrorOptions = {}
  ) {
    super(safeMessage(engine, code));
    this.name = "AnalysisEngineError";
    this.code = code;
    this.engine = engine;
    this.exitCode = options.exitCode;
    this.retryable = options.retryable ?? false;
  }
}

export class CodexAdapterError extends AnalysisEngineError {
  constructor(
    code: CodexAdapterErrorCode,
    options: AnalysisEngineErrorOptions = {}
  ) {
    super("Codex", code, options);
    this.name = "CodexAdapterError";
  }
}

export type ProcessRunnerErrorCode = "aborted" | "launch_failed";

export class ProcessRunnerError extends Error {
  readonly code: ProcessRunnerErrorCode;

  constructor(code: ProcessRunnerErrorCode) {
    super(
      code === "aborted"
        ? "The process was cancelled."
        : "The process could not be started."
    );
    this.name = "ProcessRunnerError";
    this.code = code;
  }
}

export class TemporaryOutputNotFoundError extends Error {
  constructor() {
    super("The temporary output file was not found.");
    this.name = "TemporaryOutputNotFoundError";
  }
}
