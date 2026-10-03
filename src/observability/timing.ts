export const TIMING_ENVIRONMENT_VARIABLE = "SEKISYO_DEBUG_TIMING";

const DISABLED_VALUES = new Set(["", "0", "false", "no", "off"]);

export const GIT_STATE_PHASE = "git-state";
export const QUESTION_GENERATION_PHASE = "question-generation";
export const ANSWER_JUDGMENT_PHASE = "answer-judgment";

/**
 * ゲート通過の待ち時間がどのフェーズで発生しているかを計測する。
 * 無効時はラップした処理をそのまま呼ぶだけで、副作用も出力も無い。
 */
export interface PhaseTimer {
  measure<Value>(
    phase: string,
    operation: () => Promise<Value>
  ): Promise<Value>;
}

export interface PhaseTimerOptions {
  readonly now?: () => number;
  readonly write?: (line: string) => void;
}

const NOOP_PHASE_TIMER: PhaseTimer = {
  measure: async (_phase, operation) => operation()
};

export function noopPhaseTimer(): PhaseTimer {
  return NOOP_PHASE_TIMER;
}

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function formatPhaseDuration(phase: string, durationMs: number): string {
  return `sekisyo[timing] ${phase} ${durationMs.toFixed(1)}ms`;
}

export function createPhaseTimer(options: PhaseTimerOptions = {}): PhaseTimer {
  const now = options.now ?? (() => performance.now());
  const write = options.write ?? defaultWrite;
  return {
    async measure(phase, operation) {
      const startedAt = now();
      try {
        return await operation();
      } finally {
        write(formatPhaseDuration(phase, now() - startedAt));
      }
    }
  };
}

export function isTimingEnabled(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  const value = environment[TIMING_ENVIRONMENT_VARIABLE];
  return (
    value !== undefined && !DISABLED_VALUES.has(value.trim().toLowerCase())
  );
}

/**
 * 環境変数が有効なときだけ実計測を返す。既定は no-op なので通常実行に影響しない。
 */
export function resolvePhaseTimer(
  environment: Readonly<Record<string, string | undefined>>,
  options: PhaseTimerOptions = {}
): PhaseTimer {
  return isTimingEnabled(environment)
    ? createPhaseTimer(options)
    : noopPhaseTimer();
}
