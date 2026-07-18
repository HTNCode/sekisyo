import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCliRepository } from "../../src/adapters/git/gitCliRepository.ts";

const temporaryDirectories: string[] = [];

async function git(repo: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text()
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return stdout.trim();
}

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-git-"));
  temporaryDirectories.push(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "core.hooksPath", ".git/test-hooks"]);
  await git(repo, ["config", "user.name", "Sekisyo Test"]);
  await git(repo, ["config", "user.email", "sekisyo@example.invalid"]);
  return repo;
}

async function commitFile(
  repo: string,
  path: string,
  contents: string,
  message: string
): Promise<void> {
  await writeFile(join(repo, path), contents, "utf8");
  await git(repo, ["add", "--", path]);
  await git(repo, ["commit", "-m", message]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("GitCliRepository", () => {
  test("represents a root commit explicitly and reads its full diff", async () => {
    const repo = await createRepository();
    await commitFile(repo, "file with space.txt", "root\n", "root");
    const adapter = new GitCliRepository({ cwd: repo });

    const state = await adapter.inspect(repo, {
      remote: "local",
      remoteRef: "refs/heads/main"
    });
    const range = {
      repoRoot: repo,
      base: state.base,
      diffBase: state.diffBase,
      head: state.head,
      rootCommit: state.rootCommit
    };

    expect(state.rootCommit).toBeTrue();
    expect(state.base).toBe(state.head);
    expect(await adapter.changedFiles(range)).toEqual(["file with space.txt"]);
    const fullDiff = await adapter.readDiff({
      ...range,
      maxBytes: 64 * 1_024
    });
    const exactBytes = Buffer.byteLength(fullDiff, "utf8");
    expect(fullDiff).toContain("+root");
    expect(await adapter.readDiff({ ...range, maxBytes: exactBytes })).toBe(
      fullDiff
    );
    expect(
      adapter.readDiff({ ...range, maxBytes: exactBytes - 1 })
    ).rejects.toThrow("stdout limit");
  }, 20_000);

  test("uses an explicit base before a PR base and otherwise falls back to HEAD^", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    await git(repo, ["branch", "pr-base"]);
    const prBaseOid = await git(repo, ["rev-parse", "pr-base"]);
    await commitFile(repo, "two.txt", "two\n", "two");
    const adapter = new GitCliRepository({
      cwd: repo,
      prPublisher: {
        findCurrent: async () => ({
          number: 1,
          url: "https://example.invalid/pull/1",
          state: "open",
          body: "",
          base: "pr-base",
          baseOid: prBaseOid,
          head: "a".repeat(40),
          headRefName: "main"
        })
      }
    });

    const fromPr = await adapter.inspect(repo, {
      fallbackBase: "f".repeat(40),
      remote: "local",
      remoteRef: "refs/heads/main"
    });
    const explicit = await adapter.inspect(repo, {
      base: "HEAD",
      remote: "local",
      remoteRef: "refs/heads/main"
    });

    expect(fromPr.rootCommit).toBeFalse();
    expect(fromPr.base).not.toBe(fromPr.head);
    expect(explicit.base).toBe(explicit.head);
  }, 20_000);

  test("uses the exact nonzero remote OID before HEAD^ fallback", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    const remoteOid = await git(repo, ["rev-parse", "HEAD"]);
    await commitFile(repo, "two.txt", "two\n", "two");
    await commitFile(repo, "three.txt", "three\n", "three");
    const adapter = new GitCliRepository({ cwd: repo });

    const state = await adapter.inspect(repo, {
      fallbackBase: remoteOid,
      remote: "local",
      remoteRef: "refs/heads/main"
    });
    const changedFiles = await adapter.changedFiles({
      repoRoot: repo,
      base: state.base,
      diffBase: state.diffBase,
      head: state.head
    });

    expect(state.base).toBe(remoteOid);
    expect(changedFiles).toEqual(["three.txt", "two.txt"]);
  }, 30_000);

  test("keeps the remote default ahead of the remote OID fallback", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    const remoteDefaultOid = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, [
      "update-ref",
      "refs/remotes/origin/main",
      remoteDefaultOid
    ]);
    await commitFile(repo, "two.txt", "two\n", "two");
    const fallbackOid = await git(repo, ["rev-parse", "HEAD"]);
    await commitFile(repo, "three.txt", "three\n", "three");
    const adapter = new GitCliRepository({ cwd: repo });

    const state = await adapter.inspect(repo, {
      fallbackBase: fallbackOid,
      remote: "origin",
      remoteRef: "refs/heads/main"
    });

    expect(state.base).toBe(remoteDefaultOid);
  }, 30_000);

  test("fails closed when a pushed local OID is not a commit", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    const blobOid = await git(repo, ["rev-parse", "HEAD:one.txt"]);
    const adapter = new GitCliRepository({ cwd: repo });

    expect(
      adapter.inspect(repo, {
        head: blobOid,
        remote: "local",
        remoteRef: "refs/heads/main"
      })
    ).rejects.toThrow("Unable to resolve commit reference");
  }, 20_000);

  test("fails closed when a remote fallback OID is unavailable", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    await commitFile(repo, "two.txt", "two\n", "two");
    const adapter = new GitCliRepository({ cwd: repo });

    expect(
      adapter.inspect(repo, {
        fallbackBase: "f".repeat(40),
        remote: "local",
        remoteRef: "refs/heads/main"
      })
    ).rejects.toThrow("Unable to resolve remote fallback base");
  }, 20_000);

  test("resolves Git-private paths and preserves passthrough exit codes", async () => {
    const repo = await createRepository();
    await commitFile(repo, "one.txt", "one\n", "one");
    const adapter = new GitCliRepository({ cwd: repo });

    expect((await adapter.gitPath("sekisyo")).replaceAll("\\", "/")).toContain(
      "/.git/sekisyo"
    );
    expect(adapter.gitPath("../outside")).rejects.toThrow("must stay inside");
    expect(await adapter.passthrough(["config", "--get", "missing.key"])).toBe(
      1
    );
  }, 20_000);
});
