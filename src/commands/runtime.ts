import { createCodexDiffAnalyzer } from "../adapters/codex/index.ts";
import { AtomicJsonSessionStore } from "../adapters/filesystem/index.ts";
import {
  createGitRepository,
  type GitCliRepository
} from "../adapters/git/gitCliRepository.ts";
import {
  findRepositoryRoot,
  isObjectId,
  isZeroObjectId,
  runGit
} from "../adapters/git/gitRepository.ts";
import { createPrPublisher } from "../adapters/github/ghCli.ts";
import { createOpenAIQaModel } from "../adapters/openai/index.ts";
import {
  excludedDiffPaths,
  GateError,
  type GateTarget
} from "../application/index.ts";
import {
  createPolicyDigest,
  loadSekisyoConfig,
  type SekisyoConfig
} from "../config/index.ts";
import type { GateDependencies } from "../application/gate.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type {
  DiffAnalyzer,
  GitRepository,
  QaModel,
  SessionStore,
  Terminal
} from "../ports/index.ts";

export interface TargetOverrides {
  readonly base?: string;
  readonly head?: string;
  readonly ref?: string;
  readonly remote?: string;
  readonly remoteOid?: string;
}

export interface PreparedGate {
  readonly config: SekisyoConfig;
  readonly dependencies: GateDependencies;
  readonly target: GateTarget;
}

export interface PreparedGateContext {
  readonly config: SekisyoConfig;
  readonly store: SessionStore;
  readonly target: GateTarget;
}

export interface PrepareGateContextDependencies {
  readonly createRepository: (cwd: string) => GitRepository;
  readonly createStore: (stateDirectory: string) => SessionStore;
  readonly loadConfig: (repoRoot: string) => Promise<SekisyoConfig>;
}

export interface GateDependencyFactories {
  readonly createAnalyzer: (options: {
    readonly timeoutMs: number;
  }) => DiffAnalyzer;
  readonly createModel: (options: { readonly model: string }) => QaModel;
}

const DEFAULT_CONTEXT_DEPENDENCIES: PrepareGateContextDependencies = {
  createRepository: (cwd) =>
    createGitRepository({
      cwd,
      prPublisher: createPrPublisher(cwd)
    }),
  createStore: (stateDirectory) => new AtomicJsonSessionStore(stateDirectory),
  loadConfig: loadSekisyoConfig
};

const DEFAULT_GATE_FACTORIES: GateDependencyFactories = {
  createAnalyzer: createCodexDiffAnalyzer,
  createModel: createOpenAIQaModel
};

async function tryGit(
  repoRoot: string,
  args: readonly string[]
): Promise<string | undefined> {
  try {
    return (await runGit(repoRoot, args)).stdout.trim();
  } catch {
    return undefined;
  }
}

function branchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

async function expectedRemoteOid(
  repoRoot: string,
  remote: string,
  remoteRef: string
): Promise<string> {
  const branch = branchName(remoteRef);
  if (remote !== "local") {
    const tracked = await tryGit(repoRoot, [
      "rev-parse",
      "--verify",
      `refs/remotes/${remote}/${branch}^{commit}`
    ]);
    if (tracked !== undefined && isObjectId(tracked)) {
      return tracked;
    }
  }
  const objectFormat = await tryGit(repoRoot, [
    "rev-parse",
    "--show-object-format"
  ]);
  return "0".repeat(objectFormat === "sha256" ? 64 : 40);
}

export async function prepareGateContext(
  cwd: string,
  overrides: TargetOverrides = {},
  dependencies: PrepareGateContextDependencies = DEFAULT_CONTEXT_DEPENDENCIES
): Promise<PreparedGateContext> {
  if (overrides.remoteOid !== undefined && !isObjectId(overrides.remoteOid)) {
    throw new Error("pre-push remote object ID is invalid.");
  }
  const fallbackBase =
    overrides.remoteOid !== undefined && !isZeroObjectId(overrides.remoteOid)
      ? overrides.remoteOid
      : undefined;
  const repository = dependencies.createRepository(cwd);
  const state = await repository.inspect(cwd, {
    ...(overrides.base === undefined ? {} : { base: overrides.base }),
    ...(overrides.head === undefined ? {} : { head: overrides.head }),
    ...(overrides.ref === undefined ? {} : { remoteRef: overrides.ref }),
    ...(overrides.remote === undefined ? {} : { remote: overrides.remote }),
    ...(fallbackBase === undefined ? {} : { fallbackBase })
  });
  const range = {
    base: state.base,
    diffBase: state.diffBase,
    head: state.head,
    repoRoot: state.repoRoot,
    rootCommit: state.rootCommit
  };
  const [config, changedFiles] = await Promise.all([
    dependencies.loadConfig(state.repoRoot),
    repository.changedFiles(range)
  ]);
  if (changedFiles.length > config.analysis.maxChangedFiles) {
    throw new Error(
      `変更ファイルが${changedFiles.length}件あります。設定上限は${config.analysis.maxChangedFiles}件です。`
    );
  }
  const excluded = excludedDiffPaths(changedFiles, config.privacy.exclude);
  if (excluded.length > 0) {
    throw new GateError(
      "privacy_exclusion",
      `秘密情報として除外されたパスが差分に含まれるため、内容を読み取らず中断しました: ${excluded.join(", ")}`
    );
  }

  const [diff, remoteOid, stateDirectory] = await Promise.all([
    repository.readDiff({
      ...range,
      maxBytes: config.analysis.maxDiffBytes
    }),
    overrides.remoteOid === undefined
      ? expectedRemoteOid(state.repoRoot, state.remote, state.ref)
      : Promise.resolve(overrides.remoteOid),
    repository.gitPath("sekisyo", state.repoRoot)
  ]);
  const diffDigest = fingerprint(diff);

  return {
    config,
    store: dependencies.createStore(stateDirectory),
    target: {
      analysisTarget: state.rootCommit
        ? { kind: "commit", commit: state.head }
        : { kind: "base", baseRef: state.base },
      base: state.rootCommit ? "ROOT" : state.base,
      changedFiles,
      diff,
      diffDigest,
      head: state.head,
      policyDigest: createPolicyDigest(config),
      ref: `${state.ref}@${remoteOid}`,
      remote: state.remote,
      repoRoot: state.repoRoot
    }
  };
}

export function createGateDependencies(
  context: PreparedGateContext,
  terminal: Terminal | undefined,
  factories: GateDependencyFactories = DEFAULT_GATE_FACTORIES
): GateDependencies {
  return {
    analyzer: factories.createAnalyzer({
      timeoutMs: context.config.analysis.timeoutSeconds * 1_000
    }),
    model: factories.createModel({ model: context.config.model }),
    store: context.store,
    ...(terminal === undefined ? {} : { terminal })
  };
}

export async function prepareGate(
  cwd: string,
  terminal: Terminal | undefined,
  overrides: TargetOverrides = {}
): Promise<PreparedGate> {
  const context = await prepareGateContext(cwd, overrides);
  return {
    config: context.config,
    dependencies: createGateDependencies(context, terminal),
    target: context.target
  };
}

export async function createSessionStore(cwd: string): Promise<{
  readonly repoRoot: string;
  readonly repository: GitCliRepository;
  readonly store: AtomicJsonSessionStore;
}> {
  const repoRoot = await findRepositoryRoot(cwd);
  const repository = createGitRepository({ cwd: repoRoot });
  const stateDirectory = await repository.gitPath("sekisyo", repoRoot);
  return {
    repoRoot,
    repository,
    store: new AtomicJsonSessionStore(stateDirectory)
  };
}
