import { PROMPT_VERSION, runGate } from "../application/index.ts";
import { createConsoleTerminal } from "../adapters/terminal/consoleTerminal.ts";
import { resolveCommit } from "../adapters/git/gitRepository.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import { createSessionFingerprint } from "../domain/fingerprint.ts";
import { parsePrePushInput, shouldAssessUpdate } from "../hook/prePushInput.ts";
import { prepareGate } from "./runtime.ts";

export interface PrePushHookInput {
  readonly cwd: string;
  readonly remote: string | undefined;
  readonly stdin: string;
}

export async function runPrePushHook(input: PrePushHookInput): Promise<number> {
  const updates = parsePrePushInput(input.stdin).filter(shouldAssessUpdate);
  if (updates.length === 0) {
    return 0;
  }

  let terminal = createConsoleTerminal(true);
  try {
    for (const update of updates) {
      const prepared = await prepareGate(input.cwd, terminal, {
        head: update.localOid,
        ref: update.remoteRef,
        ...(input.remote === undefined ? {} : { remote: input.remote }),
        remoteOid: update.remoteOid
      });
      const diffDigest = fingerprint(prepared.target.diff);
      const existing = await prepared.dependencies.store.load(
        createSessionFingerprint({
          base: prepared.target.base,
          head: prepared.target.head,
          model: prepared.config.model,
          policyDigest: prepared.target.policyDigest,
          promptVersion: PROMPT_VERSION,
          ref: prepared.target.ref,
          remote: prepared.target.remote
        })
      );
      const reusable =
        existing !== null &&
        existing.diffDigest === diffDigest &&
        (existing.status === "passed" || existing.status === "summarized");
      if (reusable) {
        continue;
      }
      const currentHead = await resolveCommit(prepared.target.repoRoot, "HEAD");
      if (currentHead !== update.localOid) {
        const branch = update.localRef.replace(/^refs\/heads\//u, "");
        throw new Error(
          `${branch} は現在checkoutされておらず未通過です。` +
            `そのbranchをcheckoutして \`sekisyo ask\` を実行してください。`
        );
      }
      if (terminal === undefined) {
        throw new Error(
          "対話可能な端末がありません。先に端末で `sekisyo ask` を実行してからpushしてください。"
        );
      }
      await runGate(prepared.dependencies, prepared.config, prepared.target);
    }
    return 0;
  } finally {
    terminal?.close();
    terminal = undefined;
  }
}
