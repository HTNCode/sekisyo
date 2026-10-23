import { EXIT_CODE, GateError } from "../application/index.ts";
import { resolveCommit } from "../adapters/git/git-repository.ts";
import { createConsoleTerminal } from "../adapters/terminal/console-terminal.ts";
import { TerminalInputClosedError, type Terminal } from "../ports/terminal.ts";
import { createSessionStore } from "./runtime.ts";

export interface CleanOptions {
  readonly all?: boolean;
  readonly force?: boolean;
}

interface CleanTerminal extends Pick<Terminal, "confirm"> {
  close(): void | Promise<void>;
}

export interface CleanRuntime {
  readonly createTerminal: () => CleanTerminal | undefined;
}

const DEFAULT_RUNTIME: CleanRuntime = {
  createTerminal: () => createConsoleTerminal()
};

const FORCE_GUIDANCE =
  "非対話環境では `sekisyo clean --force` を指定してください。";

/**
 * 削除の確認。端末はあっても入力がEOFになった場合は、端末がない場合と同じく
 * 削除せずに中断し、次に取るべき行動として --force を案内する。
 */
async function confirmRemoval(
  terminal: CleanTerminal,
  count: number
): Promise<boolean> {
  try {
    return await terminal.confirm(`${count}件の使い捨て記録を削除しますか?`);
  } catch (error) {
    if (!(error instanceof TerminalInputClosedError)) {
      throw error;
    }
    throw new GateError(
      "interactive_input_closed",
      "端末の入力が終了したため、削除せずに中断しました。確認せずに削除する場合は `sekisyo clean --force` を指定してください。"
    );
  }
}

export async function runCleanCommand(
  cwd: string,
  options: CleanOptions = {},
  runtime: CleanRuntime = DEFAULT_RUNTIME
): Promise<number> {
  const { repoRoot, store } = await createSessionStore(cwd);
  const sessions = await store.list();
  let resolvedTargets: typeof sessions = sessions;
  if (options.all !== true && sessions.length === 0) {
    resolvedTargets = [];
  } else if (options.all !== true) {
    const head = await resolveCommit(repoRoot, "HEAD");
    resolvedTargets = sessions.filter((session) => session.head === head);
  }
  if (resolvedTargets.length === 0) {
    console.log("削除対象の一時記録はありません。");
    return EXIT_CODE.success;
  }

  let confirmed = options.force === true;
  const terminal = runtime.createTerminal();
  try {
    if (!confirmed) {
      if (terminal === undefined) {
        throw new GateError("interactive_terminal_required", FORCE_GUIDANCE);
      }
      confirmed = await confirmRemoval(terminal, resolvedTargets.length);
    }
  } finally {
    await terminal?.close();
  }
  if (!confirmed) {
    console.log("削除を取り消しました。");
    return EXIT_CODE.cancelled;
  }

  for (const session of resolvedTargets) {
    await store.remove(session.fingerprint);
  }
  console.log(`${resolvedTargets.length}件の一時記録を削除しました。`);
  return EXIT_CODE.success;
}
