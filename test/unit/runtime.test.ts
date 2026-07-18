import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  prepareGateContext,
  type PrepareGateContextDependencies
} from "../../src/commands/runtime.ts";
import { DEFAULT_CONFIG } from "../../src/config/index.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import type { SessionRecord } from "../../src/domain/session.ts";
import type {
  GitRepository,
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
