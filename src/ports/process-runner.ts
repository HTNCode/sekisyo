export interface ProcessSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs: number;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ProcessRunner {
  run(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessResult>;
}
