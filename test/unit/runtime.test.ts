import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  createGateDependencies,
  prepareGateContext,
  type PreparedGateContext,
  type PrepareGateContextDependencies
} from "../../src/commands/runtime.ts";
import { createPolicyDigest, DEFAULT_CONFIG } from "../../src/config/index.ts";
import { createPhaseTimer } from "../../src/observability/timing.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import type { GateTarget } from "../../src/application/index.ts";
import type { SessionRecord } from "../../src/domain/session.ts";
import type {
  DiffAnalyzer,
  GitRepository,
  QaModel,
  RepositoryDiffTarget,
  RepositoryRange,
  SessionStore
} from "../../src/ports/index.ts";

const BASE_OID = "a".repeat(40);
const DIFF_BASE_OID = "b".repeat(40);
const HEAD_OID = "c".repeat(40);
const ZERO_OID = "0".repeat(40);
const DIFF = "diff --git a/file.ts b/file.ts\n";

class EmptySessionStore implements SessionStore {
  public async list(): Promise<readonly never[]> {
    return [];
  }

  public async load(_fingerprint: string): Promise<null> {
    return null;
  }

  public async remove(_fingerprint: string): Promise<void> {}

  public async save(_session: SessionRecord): Promise<void> {}
}

describe("prepareGateContext", () => {
  test("timerを渡すとgit状態解決をフェーズとして計測する", async () => {
    const repoRoot = process.cwd();
    const lines: string[] = [];
    const repository: GitRepository = {
      changedFiles: async () => ["file.ts"],
      gitPath: async () => join(repoRoot, ".git", "sekisyo"),
      inspect: async () => ({
        base: BASE_OID,
        diffBase: DIFF_BASE_OID,
        head: HEAD_OID,
        ref: "refs/heads/feature",
        remote: "origin",
        repoRoot,
        rootCommit: false
      }),
      passthrough: async () => 0,
      readDiff: async () => DIFF
    };

    await prepareGateContext(
      repoRoot,
      { remoteOid: ZERO_OID },
      {
        createRepository: () => repository,
        createStore: () => new EmptySessionStore(),
        loadConfig: async () => DEFAULT_CONFIG,
        timer: createPhaseTimer({
          now: () => 0,
          write: (line) => lines.push(line)
        })
      }
    );

    expect(lines).toEqual(["sekisyo[timing] git-state 0.0ms"]);
  });

  test("repository APIを各1回だけ呼び、既知rootとdiff-baseを再利用する", async () => {
    const repoRoot = process.cwd();
    const stateDirectory = join(repoRoot, ".git", "sekisyo");
    const calls = {
      changedFiles: 0,
      createRepository: 0,
      createStore: 0,
      gitPath: 0,
      inspect: 0,
      loadConfig: 0,
      readDiff: 0
    };
    let changedRange: RepositoryRange | undefined;
    let diffTarget: RepositoryDiffTarget | undefined;
    let gitPathRoot: string | undefined;
    const repository: GitRepository = {
      changedFiles: async (target) => {
        calls.changedFiles += 1;
        changedRange = target;
        return ["file.ts"];
      },
      gitPath: async (_path, knownRoot) => {
        calls.gitPath += 1;
        gitPathRoot = knownRoot;
        return stateDirectory;
      },
      inspect: async () => {
        calls.inspect += 1;
        return {
          base: BASE_OID,
          diffBase: DIFF_BASE_OID,
          head: HEAD_OID,
          ref: "refs/heads/feature",
          remote: "origin",
          repoRoot,
          rootCommit: false
        };
      },
      passthrough: async () => 0,
      readDiff: async (target) => {
        calls.readDiff += 1;
        diffTarget = target;
        return DIFF;
      }
    };
    const store = new EmptySessionStore();
    const dependencies: PrepareGateContextDependencies = {
      createRepository: () => {
        calls.createRepository += 1;
        return repository;
      },
      createStore: (directory) => {
        calls.createStore += 1;
        expect(directory).toBe(stateDirectory);
        return store;
      },
      loadConfig: async (root) => {
        calls.loadConfig += 1;
        expect(root).toBe(repoRoot);
        return DEFAULT_CONFIG;
      }
    };

    const prepared = await prepareGateContext(
      repoRoot,
      {
        remoteOid: ZERO_OID
      },
      dependencies
    );

    expect(calls).toEqual({
      changedFiles: 1,
      createRepository: 1,
      createStore: 1,
      gitPath: 1,
      inspect: 1,
      loadConfig: 1,
      readDiff: 1
    });
    expect(changedRange?.diffBase).toBe(DIFF_BASE_OID);
    expect(diffTarget?.diffBase).toBe(DIFF_BASE_OID);
    expect(gitPathRoot).toBe(repoRoot);
    expect(prepared.store).toBe(store);
    expect(prepared.target.diffDigest).toBe(fingerprint(DIFF));
  });
});

const stubAnalyzer: DiffAnalyzer = {
  analyze: async () => ({
    attention: [],
    filesChanged: 1,
    findings: [],
    risks: [],
    summary: "summary"
  })
};

const stubModel: QaModel = {
  generateQuestions: async () => [],
  judgeAnswer: async () => ({ feedback: "ok", passed: true }),
  summarize: async () => ({
    decisions: [],
    intent: "intent",
    risks: [],
    unresolved: [],
    verification: []
  })
};

function gateTarget(): GateTarget {
  return {
    analysisTarget: { kind: "base", baseRef: BASE_OID },
    base: BASE_OID,
    changedFiles: ["file.ts"],
    diff: DIFF,
    diffDigest: fingerprint(DIFF),
    head: HEAD_OID,
    policyDigest: createPolicyDigest(DEFAULT_CONFIG),
    ref: `refs/heads/feature@${ZERO_OID}`,
    remote: "origin",
    repoRoot: "C:\\repo"
  };
}

function analyzerOptionsFor(model: string | undefined): {
  readonly model?: string;
} {
  const context: PreparedGateContext = {
    config: {
      ...DEFAULT_CONFIG,
      analysis: {
        ...DEFAULT_CONFIG.analysis,
        ...(model === undefined ? {} : { model })
      }
    },
    store: new EmptySessionStore(),
    target: gateTarget()
  };
  let received: { readonly model?: string } = {};
  createGateDependencies(context, undefined, {
    createAnalyzer: (options) => {
      received = options;
      return stubAnalyzer;
    },
    createModel: () => stubModel
  });
  return received;
}

describe("createGateDependencies", () => {
  test("analysis.modelをanalyzerへ渡す", () => {
    expect(analyzerOptionsFor("gpt-5.6-codex").model).toBe("gpt-5.6-codex");
  });

  test("analysis.model未指定ならanalyzerにmodelキーを渡さない", () => {
    const options = analyzerOptionsFor(undefined);
    expect(Object.hasOwn(options, "model")).toBe(false);
  });
});
