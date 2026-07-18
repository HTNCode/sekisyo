import { PROMPT_VERSION } from "../application/gate.ts";
import type { SessionRecord } from "../domain/session.ts";
import type { GateTarget } from "../application/gate.ts";
import type { SekisyoConfig } from "../config/schema.ts";
import { prepareGateContext } from "./runtime.ts";

function destinationRef(ref: string): string {
  return ref.replace(/@(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu, "");
}

export function isCurrentSession(
  session: SessionRecord,
  config: SekisyoConfig,
  target: GateTarget,
  currentDiffDigest: string
): boolean {
  return (
    session.base === target.base &&
    session.diffDigest === currentDiffDigest &&
    session.head === target.head &&
    session.model === config.model &&
    session.policyDigest === target.policyDigest &&
    session.promptVersion === PROMPT_VERSION &&
    destinationRef(session.ref) === destinationRef(target.ref) &&
    session.remote === target.remote
  );
}

export async function runStatusCommand(cwd: string): Promise<number> {
  const { config, store, target } = await prepareGateContext(cwd);
  const sessions = (await store.list())
    .filter((session) => session.head === target.head)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (sessions.length === 0) {
    console.log("現在のHEADに対応するSekisyo記録はありません。");
    console.log("`sekisyo ask` で口頭試問を開始してください。");
    return 1;
  }

  console.log(`HEAD ${target.head}`);
  for (const session of sessions) {
    const isCurrent = isCurrentSession(
      session,
      config,
      target,
      target.diffDigest
    );
    const passed = session.attempts.filter((attempt) => attempt.passed).length;
    console.log(
      [
        `- ${session.status}`,
        isCurrent ? "現在の差分" : "stale",
        `手形=${session.fingerprint.slice(0, 12)}`,
        `質問=${session.questions.length}`,
        `通過回答=${passed}`,
        `更新=${session.updatedAt}`
      ].join(" / ")
    );
    const pendingFindings =
      (session.analysis?.findings.length ?? 0) -
      session.reviewResolutions.length;
    if (pendingFindings > 0) {
      console.log(`  一次レビュー未解決: ${pendingFindings}件`);
    }
  }
  return sessions.some(
    (session) =>
      isCurrentSession(session, config, target, target.diffDigest) &&
      (session.status === "passed" || session.status === "summarized")
  )
    ? 0
    : 1;
}
