import { resolveCommit } from "../adapters/git/gitRepository.ts";
import { createConsoleTerminal } from "../adapters/terminal/consoleTerminal.ts";
import { createSessionStore } from "./runtime.ts";

export interface CleanOptions {
  readonly all?: boolean;
  readonly force?: boolean;
}

export async function runCleanCommand(
  cwd: string,
  options: CleanOptions = {}
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
    return 0;
  }

  let confirmed = options.force === true;
  const terminal = createConsoleTerminal();
  try {
    if (!confirmed) {
      if (terminal === undefined) {
        throw new Error(
          "非対話環境では `sekisyo clean --force` を指定してください。"
        );
      }
      confirmed = await terminal.confirm(
        `${resolvedTargets.length}件の使い捨て記録を削除しますか?`
      );
    }
  } finally {
    await terminal?.close();
  }
  if (!confirmed) {
    console.log("削除を取り消しました。");
    return 1;
  }

  for (const session of resolvedTargets) {
    await store.remove(session.fingerprint);
  }
  console.log(`${resolvedTargets.length}件の一時記録を削除しました。`);
  return 0;
}
