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

const SAFE_MESSAGES: Readonly<Record<CodexAdapterErrorCode, string>> = {
  aborted: "The Codex analysis was cancelled.",
  failed_event: "Codex reported that the analysis failed.",
  filesystem: "The temporary Codex workspace could not be managed.",
  invalid_event_stream: "Codex returned an invalid event stream.",
  invalid_input: "The Codex adapter received invalid input.",
  invalid_output: "Codex returned invalid structured output.",
  missing_output: "Codex did not create the structured output file.",
  non_zero_exit: "Codex exited without completing the analysis.",
  not_installed: "The Codex executable could not be started.",
  repository_preparation:
    "The clean repository snapshot for Codex could not be prepared.",
  timeout: "The Codex analysis timed out.",
  unknown: "The Codex analysis failed."
};

export class CodexAdapterError extends Error {
  readonly code: CodexAdapterErrorCode;
  readonly exitCode: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: CodexAdapterErrorCode,
    options: {
      readonly exitCode?: number;
      readonly retryable?: boolean;
    } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "CodexAdapterError";
    this.code = code;
    this.exitCode = options.exitCode;
    this.retryable = options.retryable ?? false;
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
