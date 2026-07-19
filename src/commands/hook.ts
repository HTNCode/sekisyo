import {
  PROMPT_VERSION,
  runGate,
  type GateDependencies,
  type RunGateOptions
} from "../application/index.ts";
import { createConsoleTerminal } from "../adapters/terminal/consoleTerminal.ts";
import { resolveCommit } from "../adapters/git/gitRepository.ts";
import { createSessionFingerprint } from "../domain/fingerprint.ts";
import type { SessionRecord } from "../domain/session.ts";
import type { Terminal } from "../ports/terminal.ts";
import { parsePrePushInput, shouldAssessUpdate } from "../hook/prePushInput.ts";
import {
  createGateDependencies,
  prepareGateContext,
  type PreparedGateContext,
  type TargetOverrides
} from "./runtime.ts";

export interface PrePushHookInput {
  readonly cwd: string;
  readonly remote: string | undefined;
  readonly stdin: string;
}

interface HookTerminal extends Terminal {
  close(): void | Promise<void>;
}

export interface PrePushHookRuntime {
  readonly createDependencies: (
    context: PreparedGateContext,
    terminal: Terminal
  ) => GateDependencies;
  readonly createTerminal: () => HookTerminal | undefined;
  readonly prepareContext: (
    cwd: string,
    overrides: TargetOverrides
  ) => Promise<PreparedGateContext>;
  readonly resolveCommit: (
    repoRoot: string,
    reference: string
  ) => Promise<string>;
  readonly runGate: (
    dependencies: GateDependencies,
    config: PreparedGateContext["config"],
    target: PreparedGateContext["target"],
    options?: RunGateOptions
  ) => Promise<SessionRecord>;
}

const DEFAULT_RUNTIME: PrePushHookRuntime = {
  createDependencies: createGateDependencies,
  createTerminal: () => createConsoleTerminal(true),
  prepareContext: prepareGateContext,
  resolveCommit,
  runGate
};

export async function runPrePushHook(
  input: PrePushHookInput,
  runtime: PrePushHookRuntime = DEFAULT_RUNTIME
): Promise<number> {
  const updates = parsePrePushInput(input.stdin).filter(shouldAssessUpdate);
  if (updates.length === 0) {
    return 0;
  }

  let terminal: HookTerminal | undefined;
  try {
    for (const update of updates) {
      const prepared = await runtime.prepareContext(input.cwd, {
        head: update.localOid,
        ref: update.remoteRef,
        ...(input.remote === undefined ? {} : { remote: input.remote }),
        remoteOid: update.remoteOid
      });
      const existing = await prepared.store.load(
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
        existing.diffDigest === prepared.target.diffDigest &&
        (existing.status === "passed" || existing.status === "summarized");
      if (reusable) {
        continue;
      }
      const currentHead = await runtime.resolveCommit(
        prepared.target.repoRoot,
        "HEAD"
      );
      if (currentHead !== update.localOid) {
        const branch = update.localRef.replace(/^refs\/heads\//u, "");
        throw new Error(
          `${branch} は現在checkoutされておらず未通過です。` +
            `そのbranchをcheckoutして \`sekisyo ask\` を実行してください。`
        );
      }
      terminal ??= runtime.createTerminal();
      if (terminal === undefined) {
        throw new Error(
          "対話可能な端末がありません。先に端末で `sekisyo ask` を実行してからpushしてください。"
        );
      }
      const dependencies = runtime.createDependencies(prepared, terminal);
      await runtime.runGate(dependencies, prepared.config, prepared.target, {
        allowReuse: false
      });
    }
    return 0;
  } finally {
    await terminal?.close();
  }
}
