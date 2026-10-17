import {
  EXIT_CODE,
  GateError,
  PROMPT_VERSION,
  runGate,
  type GateDependencies,
  type RunGateOptions
} from "../application/index.ts";
import { createConsoleTerminal } from "../adapters/terminal/console-terminal.ts";
import { resolveCommit } from "../adapters/git/git-repository.ts";
import { configQaModelDescriptor } from "../config/model.ts";
import { createSessionFingerprint } from "../domain/fingerprint.ts";
import {
  coverPushWithCommitRecords,
  type PushUpdate
} from "./commit-coverage.ts";
import type { SessionRecord } from "../domain/session.ts";
import type { Terminal } from "../ports/terminal.ts";
import {
  parsePrePushInput,
  shouldAssessUpdate
} from "../hook/pre-push-input.ts";
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
  /** commit 時の通過記録で push 範囲がまかなえるなら、まとめた記録を返す。 */
  readonly coverWithCommitRecords?: (
    context: PreparedGateContext,
    update: PushUpdate
  ) => Promise<SessionRecord | undefined>;
}

const DEFAULT_RUNTIME: PrePushHookRuntime = {
  createDependencies: createGateDependencies,
  createTerminal: () => createConsoleTerminal(true),
  prepareContext: prepareGateContext,
  resolveCommit,
  runGate,
  coverWithCommitRecords: (context, update) =>
    coverPushWithCommitRecords(context, update, new Date().toISOString())
};

export const COMMIT_COVERAGE_MESSAGE =
  "sekisyo: このpushのコミットはすべてcommit時の試問を通過済みのため、push時の試問を省きました。";

export async function runPrePushHook(
  input: PrePushHookInput,
  runtime: PrePushHookRuntime = DEFAULT_RUNTIME
): Promise<number> {
  const updates = parsePrePushInput(input.stdin).filter(shouldAssessUpdate);
  if (updates.length === 0) {
    return EXIT_CODE.success;
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
          model: configQaModelDescriptor(prepared.config),
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
      const covered = await runtime.coverWithCommitRecords?.(prepared, update);
      if (covered !== undefined) {
        console.error(COMMIT_COVERAGE_MESSAGE);
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
        throw new GateError(
          "interactive_terminal_required",
          "対話可能な端末がありません。先に端末で `sekisyo ask` を実行してからpushしてください。"
        );
      }
      const dependencies = runtime.createDependencies(prepared, terminal);
      await runtime.runGate(dependencies, prepared.config, prepared.target, {
        allowReuse: false
      });
    }
    return EXIT_CODE.success;
  } finally {
    await terminal?.close();
  }
}
