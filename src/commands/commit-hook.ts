import { AtomicJsonSessionStore } from "../adapters/filesystem/index.ts";
import { createGitRepository } from "../adapters/git/git-cli-repository.ts";
import { findRepositoryRoot } from "../adapters/git/git-repository.ts";
import {
  isMergeInProgress,
  readStagedChangedFiles,
  readStagedDiff,
  resolveHeadCommit,
  writeIndexTree
} from "../adapters/git/staged-changes.ts";
import { createConsoleTerminal } from "../adapters/terminal/console-terminal.ts";
import {
  EXIT_CODE,
  excludedDiffPaths,
  GateError,
  PROMPT_VERSION,
  runGate,
  type GateDependencies,
  type GateTarget,
  type RunGateOptions
} from "../application/index.ts";
import {
  configQaModelDescriptor,
  createPolicyDigest,
  loadSekisyoConfig,
  type SekisyoConfig
} from "../config/index.ts";
import {
  commitRecordBinding,
  COMMIT_RECORD_REMOTE
} from "../domain/commit-record.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type { SessionRecord } from "../domain/session.ts";
import type { SessionStore } from "../ports/session-store.ts";
import type { Terminal } from "../ports/terminal.ts";
import { createGateDependencies, type PreparedGateContext } from "./runtime.ts";

interface HookTerminal extends Terminal {
  close(): void | Promise<void>;
}

export type StagedChanges =
  | { readonly kind: "initial_commit" }
  | { readonly kind: "merge_in_progress" }
  | {
      readonly kind: "staged";
      readonly changedFiles: readonly string[];
      readonly diff: string;
      readonly parent: string;
      readonly tree: string;
    };

export interface PreCommitHookRuntime {
  readonly createDependencies: (
    context: PreparedGateContext,
    terminal: Terminal
  ) => GateDependencies;
  readonly createStore: (repoRoot: string) => Promise<SessionStore>;
  readonly createTerminal: () => HookTerminal | undefined;
  readonly findRepositoryRoot: (cwd: string) => Promise<string>;
  readonly loadConfig: (repoRoot: string) => Promise<SekisyoConfig>;
  readonly readStagedChanges: (
    repoRoot: string,
    maxDiffBytes: number
  ) => Promise<StagedChanges>;
  readonly runGate: (
    dependencies: GateDependencies,
    config: SekisyoConfig,
    target: GateTarget,
    options?: RunGateOptions
  ) => Promise<SessionRecord>;
}

async function readStagedChanges(
  repoRoot: string,
  maxDiffBytes: number
): Promise<StagedChanges> {
  const parent = await resolveHeadCommit(repoRoot);
  if (parent === undefined) {
    return { kind: "initial_commit" };
  }
  if (await isMergeInProgress(repoRoot)) {
    return { kind: "merge_in_progress" };
  }
  const changedFiles = await readStagedChangedFiles(repoRoot, parent);
  if (changedFiles.length === 0) {
    return { kind: "staged", changedFiles, diff: "", parent, tree: parent };
  }
  const [tree, diff] = await Promise.all([
    writeIndexTree(repoRoot),
    readStagedDiff(repoRoot, parent, maxDiffBytes)
  ]);
  return { kind: "staged", changedFiles, diff, parent, tree };
}

const DEFAULT_RUNTIME: PreCommitHookRuntime = {
  createDependencies: createGateDependencies,
  createStore: async (repoRoot) =>
    new AtomicJsonSessionStore(
      await createGitRepository({ cwd: repoRoot }).gitPath("sekisyo", repoRoot)
    ),
  createTerminal: () => createConsoleTerminal(true),
  findRepositoryRoot,
  loadConfig: loadSekisyoConfig,
  readStagedChanges,
  runGate
};

// エージェントが commit するシェルで実際に設定されていた目印（Claude Code で確認）。
// 端末が開けないことに加えての保険で、ここに無いエージェントは端末の有無で判定する。
const AGENT_ENVIRONMENT_MARKERS = ["AI_AGENT", "CLAUDECODE"] as const;

export function isAgentEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return AGENT_ENVIRONMENT_MARKERS.some(
    (name) => (environment[name] ?? "").length > 0
  );
}

export const AGENT_SKIP_MESSAGE =
  "sekisyo: 対話できる端末が無いため、commit時の試問を省きました。push時に試問します。";

/**
 * commit 時の関所。人が端末で commit したときだけ試問し、エージェントや IDE の
 * ように対話できる端末が無い commit はそのまま通す（push 時に改めて試問される）。
 */
export async function runPreCommitHook(
  input: {
    readonly cwd: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  runtime: PreCommitHookRuntime = DEFAULT_RUNTIME
): Promise<number> {
  // 設定の読み込みより先に判定する。設定の誤りでエージェントの commit まで
  // 止めないため。
  if (isAgentEnvironment(input.environment ?? process.env)) {
    console.error(AGENT_SKIP_MESSAGE);
    return EXIT_CODE.success;
  }
  const terminal = runtime.createTerminal();
  if (terminal === undefined) {
    console.error(AGENT_SKIP_MESSAGE);
    return EXIT_CODE.success;
  }

  try {
    const repoRoot = await runtime.findRepositoryRoot(input.cwd);
    const config = await runtime.loadConfig(repoRoot);
    if (config.triggers?.commit !== true) {
      return EXIT_CODE.success;
    }
    const staged = await runtime.readStagedChanges(
      repoRoot,
      config.analysis.maxDiffBytes
    );
    if (staged.kind === "initial_commit") {
      console.error(
        "sekisyo: 最初のコミットのため、commit時の試問を省きました。push時に試問します。"
      );
      return EXIT_CODE.success;
    }
    if (staged.kind === "merge_in_progress") {
      console.error(
        "sekisyo: マージの確定のため、commit時の試問を省きました。push時に試問します。"
      );
      return EXIT_CODE.success;
    }
    if (staged.changedFiles.length === 0 || staged.diff.trim().length === 0) {
      return EXIT_CODE.success;
    }
    if (staged.changedFiles.length > config.analysis.maxChangedFiles) {
      throw new Error(
        `変更ファイルが${staged.changedFiles.length}件あります。設定上限は${config.analysis.maxChangedFiles}件です。`
      );
    }
    const excluded = excludedDiffPaths(
      staged.changedFiles,
      config.privacy.exclude
    );
    if (excluded.length > 0) {
      throw new GateError(
        "privacy_exclusion",
        `秘密情報として除外されたパスが差分に含まれるため、内容を読み取らず中断しました: ${excluded.join(", ")}`
      );
    }

    const policyDigest = createPolicyDigest(config);
    const binding = commitRecordBinding({
      parent: staged.parent,
      tree: staged.tree,
      policyDigest,
      promptVersion: PROMPT_VERSION,
      model: configQaModelDescriptor(config)
    });
    const target: GateTarget = {
      // スナップショットはステージ済みのツリーから作り、コミット後と同じ内容を見せる。
      analysisTarget: { kind: "base", baseRef: staged.parent },
      base: binding.base,
      changedFiles: staged.changedFiles,
      diff: staged.diff,
      diffDigest: fingerprint(staged.diff),
      head: binding.head,
      policyDigest,
      ref: binding.ref,
      remote: COMMIT_RECORD_REMOTE,
      repoRoot
    };
    const context: PreparedGateContext = {
      config,
      store: await runtime.createStore(repoRoot),
      target
    };
    await runtime.runGate(
      runtime.createDependencies(context, terminal),
      config,
      target
    );
    return EXIT_CODE.success;
  } finally {
    await terminal.close();
  }
}
