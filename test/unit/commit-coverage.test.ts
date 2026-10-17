import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveHeadCommit,
  writeIndexTree,
  type CommitSummary
} from "../../src/adapters/git/staged-changes.ts";
import { PROMPT_VERSION } from "../../src/application/gate.ts";
import { coverPushWithCommitRecords } from "../../src/commands/commit-coverage.ts";
import { latestPublishableSession } from "../../src/commands/pr.ts";
import type { PreparedGateContext } from "../../src/commands/runtime.ts";
import { createPolicyDigest, parseConfig } from "../../src/config/index.ts";
import { commitRecordBinding } from "../../src/domain/commit-record.ts";
import type { SessionRecord } from "../../src/domain/session.ts";
import type { SessionStore } from "../../src/ports/session-store.ts";
import { bindingFor, passedSession } from "./support/passed-session.ts";

const ZERO = "0".repeat(40);
const BASE = "1".repeat(40);
const C1 = "c".repeat(39) + "1";
const C2 = "c".repeat(39) + "2";
const T1 = "e".repeat(39) + "1";
const T2 = "e".repeat(39) + "2";
const REMOTE_HEAD = "d".repeat(40);
const NOW = "2026-10-18T02:00:00.000Z";

class MemoryStore implements SessionStore {
  readonly records = new Map<string, SessionRecord>();
  async load(fingerprint: string): Promise<SessionRecord | null> {
    return this.records.get(fingerprint) ?? null;
  }
  async list(): Promise<readonly SessionRecord[]> {
    return [...this.records.values()];
  }
  async save(session: SessionRecord): Promise<void> {
    this.records.set(session.fingerprint, session);
  }
  async remove(fingerprint: string): Promise<void> {
    this.records.delete(fingerprint);
  }
}

const config = parseConfig({ triggers: { commit: true } });
const policyDigest = createPolicyDigest(config);

function contextFor(store: MemoryStore): PreparedGateContext {
  return {
    config,
    store,
    target: {
      analysisTarget: { kind: "base", baseRef: BASE },
      base: BASE,
      changedFiles: ["a.ts", "b.ts"],
      diff: "diff",
      diffDigest: "b".repeat(64),
      head: C2,
      policyDigest,
      ref: `refs/heads/feature@${ZERO}`,
      remote: "origin",
      repoRoot: "/repo"
    }
  };
}

function saveCommitRecord(
  store: MemoryStore,
  parent: string,
  tree: string
): void {
  const binding = commitRecordBinding({
    parent,
    tree,
    policyDigest,
    promptVersion: PROMPT_VERSION,
    model: "gpt-5.6-sol"
  });
  const session = passedSession(
    { ...binding, diffDigest: "f".repeat(64) },
    tree.slice(-1)
  );
  store.records.set(session.fingerprint, session);
}

function gitFor(
  commits: readonly CommitSummary[],
  ancestor = true
): Parameters<typeof coverPushWithCommitRecords>[3] {
  return {
    isAncestor: async () => ancestor,
    listCommits: async () => commits
  };
}

const linear: readonly CommitSummary[] = [
  { oid: C1, tree: T1, parents: [BASE] },
  { oid: C2, tree: T2, parents: [C1] }
];

describe("coverPushWithCommitRecords", () => {
  test("新しいブランチの全コミットがcommit時に通過済みなら、まとめた記録を保存する", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, BASE, T1);
    saveCommitRecord(store, C1, T2);
    const context = contextFor(store);

    const covered = await coverPushWithCommitRecords(
      context,
      { localOid: C2, remoteOid: ZERO },
      NOW,
      gitFor(linear)
    );

    expect(covered?.status).toBe("passed");
    expect(covered?.questions).toHaveLength(2);
    expect(store.records.get(covered?.fingerprint ?? "")).toEqual(covered);
    // sekisyo pr が同じ記録を見つけられること
    expect(
      latestPublishableSession([...store.records.values()], {
        base: BASE,
        diffDigest: context.target.diffDigest,
        head: C2,
        model: "gpt-5.6-sol",
        policyDigest,
        promptVersion: PROMPT_VERSION,
        ref: "refs/heads/feature",
        remote: "origin"
      })?.fingerprint
    ).toBe(covered?.fingerprint);
  });

  test("通過記録の無いコミットが1つでもあればまとめない", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, BASE, T1);
    expect(
      await coverPushWithCommitRecords(
        contextFor(store),
        { localOid: C2, remoteOid: ZERO },
        NOW,
        gitFor(linear)
      )
    ).toBeUndefined();
  });

  test("親が変わったコミット（rebaseなど）は通過記録と一致しない", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, BASE, T1);
    saveCommitRecord(store, BASE, T2);
    expect(
      await coverPushWithCommitRecords(
        contextFor(store),
        { localOid: C2, remoteOid: ZERO },
        NOW,
        gitFor(linear)
      )
    ).toBeUndefined();
  });

  test("マージコミットを含むならまとめない", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, BASE, T1);
    expect(
      await coverPushWithCommitRecords(
        contextFor(store),
        { localOid: C1, remoteOid: ZERO },
        NOW,
        gitFor([{ oid: C1, tree: T1, parents: [BASE, REMOTE_HEAD] }])
      )
    ).toBeUndefined();
  });

  test("remoteにあるコミットは、そのheadを通過させた前回のpush記録でまかなう", async () => {
    const store = new MemoryStore();
    const previous = passedSession(
      bindingFor({
        base: BASE,
        head: REMOTE_HEAD,
        policyDigest,
        promptVersion: PROMPT_VERSION,
        ref: `refs/heads/feature@${"9".repeat(40)}`
      }),
      "previous"
    );
    store.records.set(previous.fingerprint, previous);
    saveCommitRecord(store, REMOTE_HEAD, T2);

    const covered = await coverPushWithCommitRecords(
      contextFor(store),
      { localOid: C2, remoteOid: REMOTE_HEAD },
      NOW,
      gitFor([{ oid: C2, tree: T2, parents: [REMOTE_HEAD] }])
    );

    expect(covered?.analysis?.summary).toContain("[前回のpush]");
    expect(covered?.questions).toHaveLength(2);
  });

  test("sekisyo prで公開済みになった前回のpush記録でもまかなえる", async () => {
    const store = new MemoryStore();
    const previous = {
      ...passedSession(
        bindingFor({
          base: BASE,
          head: REMOTE_HEAD,
          policyDigest,
          promptVersion: PROMPT_VERSION
        }),
        "previous"
      ),
      status: "published" as const
    };
    store.records.set(previous.fingerprint, previous);
    saveCommitRecord(store, REMOTE_HEAD, T2);

    const covered = await coverPushWithCommitRecords(
      contextFor(store),
      { localOid: C2, remoteOid: REMOTE_HEAD },
      NOW,
      gitFor([{ oid: C2, tree: T2, parents: [REMOTE_HEAD] }])
    );
    expect(covered?.status).toBe("passed");
  });

  test("前回のpush記録が無い、または早送りでないpushではまとめない", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, REMOTE_HEAD, T2);
    const update = { localOid: C2, remoteOid: REMOTE_HEAD };
    const commits = [{ oid: C2, tree: T2, parents: [REMOTE_HEAD] }];
    expect(
      await coverPushWithCommitRecords(
        contextFor(store),
        update,
        NOW,
        gitFor(commits)
      )
    ).toBeUndefined();

    const previous = passedSession(
      bindingFor({
        base: BASE,
        head: REMOTE_HEAD,
        policyDigest,
        promptVersion: PROMPT_VERSION
      }),
      "previous"
    );
    store.records.set(previous.fingerprint, previous);
    expect(
      await coverPushWithCommitRecords(
        contextFor(store),
        update,
        NOW,
        gitFor(commits, false)
      )
    ).toBeUndefined();
  });

  test("commit時の試問を有効にしていなければ何もしない", async () => {
    const store = new MemoryStore();
    saveCommitRecord(store, BASE, T1);
    saveCommitRecord(store, C1, T2);
    const context = { ...contextFor(store), config: parseConfig({}) };
    expect(
      await coverPushWithCommitRecords(
        context,
        { localOid: C2, remoteOid: ZERO },
        NOW,
        gitFor(linear)
      )
    ).toBeUndefined();
  });

  test("実際のgitで、commit時に記録した親とツリーをpush時に見つけられる", async () => {
    const repo = await mkdtemp(join(tmpdir(), "sekisyo-coverage-"));
    temporaryDirectories.push(repo);
    const git = async (args: readonly string[]): Promise<string> => {
      const child = Bun.spawn(
        [
          "git",
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",

          ...args
        ],
        { cwd: repo, stdout: "pipe", stderr: "pipe" }
      );
      if ((await child.exited) !== 0) {
        throw new Error(await new Response(child.stderr).text());
      }
      return (await new Response(child.stdout).text()).trim();
    };
    await git(["init", "-b", "main"]);
    // 差分表示の設定が変わっても、ツリーでの照合には影響しないことも確かめる
    await git(["config", "diff.mnemonicPrefix", "true"]);
    await writeFile(join(repo, "a.txt"), "one\n");
    await git(["add", "a.txt"]);
    await git(["commit", "-m", "base"]);
    const base = (await resolveHeadCommit(repo)) ?? "";

    await writeFile(join(repo, "a.txt"), "two\n");
    await git(["add", "a.txt"]);
    const store = new MemoryStore();
    saveCommitRecord(store, base, await writeIndexTree(repo));
    await git(["commit", "-m", "change"]);
    const head = await git(["rev-parse", "HEAD"]);

    const context = contextFor(store);
    const covered = await coverPushWithCommitRecords(
      {
        ...context,
        target: { ...context.target, base, head, repoRoot: repo }
      },
      { localOid: head, remoteOid: ZERO },
      NOW
    );
    expect(covered?.status).toBe("passed");
  });
});

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});
