import type {
  ProcessResult,
  ProcessRunner,
  ProcessSpec
} from "../../ports/process-runner.ts";
import { CodexAdapterError, ProcessRunnerError } from "./errors.ts";

const MAX_CAPTURED_BYTES = 2 * 1_024 * 1_024;
const FORCE_KILL_DELAY_MS = 1_000;

async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const fragments: string[] = [];
  let retainedBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    const remaining = limit - retainedBytes;
    if (remaining <= 0) {
      continue;
    }

    const retained = result.value.subarray(
      0,
      Math.min(remaining, result.value.byteLength)
    );
    fragments.push(decoder.decode(retained, { stream: true }));
    retainedBytes += retained.byteLength;
  }

  fragments.push(decoder.decode());
  return fragments.join("");
}

function assertProcessSpec(spec: ProcessSpec): void {
  if (
    spec.argv.length === 0 ||
    spec.cwd.trim().length === 0 ||
    !Number.isInteger(spec.timeoutMs) ||
    spec.timeoutMs <= 0
  ) {
    throw new CodexAdapterError("invalid_input");
  }
}

export class BunProcessRunner implements ProcessRunner {
  async run(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessResult> {
    assertProcessSpec(spec);
    if (signal?.aborted === true) {
      throw new ProcessRunnerError("aborted");
    }

    let subprocess: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      subprocess = Bun.spawn({
        cmd: [...spec.argv],
        cwd: spec.cwd,
        env: { ...spec.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe"
      });
    } catch {
      throw new ProcessRunnerError("launch_failed");
    }

    if (spec.stdin === undefined) {
      subprocess.stdin.end();
    } else {
      subprocess.stdin.write(spec.stdin);
      subprocess.stdin.end();
    }

    let timedOut = false;
    let aborted = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (): void => {
      if (subprocess.exitCode !== null) {
        return;
      }
      subprocess.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (subprocess.exitCode === null) {
          subprocess.kill("SIGKILL");
        }
      }, FORCE_KILL_DELAY_MS);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, spec.timeoutMs);
    const abortListener = (): void => {
      aborted = true;
      terminate();
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        readLimitedText(subprocess.stdout, MAX_CAPTURED_BYTES),
        readLimitedText(subprocess.stderr, MAX_CAPTURED_BYTES),
        subprocess.exited
      ]);

      if (aborted) {
        throw new ProcessRunnerError("aborted");
      }

      return {
        exitCode,
        stderr,
        stdout,
        timedOut
      };
    } finally {
      clearTimeout(timeoutTimer);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      signal?.removeEventListener("abort", abortListener);
    }
  }
}
