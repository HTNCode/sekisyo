import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isAncestorCommit,
  listCommitsSince,
  readStagedChangedFiles,
  readStagedDiff,
  resolveHeadCommit,
  writeIndexTree
} from "../../../../src/adapters/git/staged-changes.ts";

const temporaryDirectories: string[] = [];
const originalIndexFile = process.env.GIT_INDEX_FILE;

afterEach(async () => {
  if (originalIndexFile === undefined) {
    delete process.env.GIT_INDEX_FILE;
  } else {
    process.env.GIT_INDEX_FILE = originalIndexFile;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
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
    // GIT_INDEX_FILE の切り替えを反映させるため、現在の環境を明示的に渡す。
    { cwd, env: { ...process.env }, stdout: "pipe", stderr: "pipe" }
  );
  if ((await child.exited) !== 0) {
    throw new Error(await new Response(child.stderr).text());
  }
  return (await new Response(child.stdout).text()).trim();
}

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-staged-"));
  temporaryDirectories.push(repo);
  await git(repo, ["init", "-b", "main"]);
  return repo;
}

describe("staged changes", () => {
  test("最初のコミット前はHEADが無い", async () => {
    const repo = await createRepository();
    expect(await resolveHeadCommit(repo)).toBeUndefined();
  });

  test("ステージ済みのツリーはコミット後のツリーと一致する", async () => {
    const repo = await createRepository();
    await writeFile(join(repo, "a.txt"), "one\n");
    await git(repo, ["add", "a.txt"]);
    await git(repo, ["commit", "-m", "init"]);
    const parent = await resolveHeadCommit(repo);

    await writeFile(join(repo, "a.txt"), "two\n");
    await writeFile(join(repo, "b.txt"), "new\n");
    await git(repo, ["add", "a.txt", "b.txt"]);
    // ステージしていない変更は対象外
    await writeFile(join(repo, "a.txt"), "three\n");

    const tree = await writeIndexTree(repo);
    expect(await readStagedChangedFiles(repo, parent ?? "")).toEqual([
      "a.txt",
      "b.txt"
    ]);
    const diff = await readStagedDiff(repo, parent ?? "", 1_000_000);
    expect(diff).toContain("+two");
    expect(diff).not.toContain("three");

    await git(repo, ["commit", "-m", "change"]);
    expect(await git(repo, ["rev-parse", "HEAD^{tree}"])).toBe(tree);

    const commits = await listCommitsSince(repo, "HEAD", parent);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.tree).toBe(tree);
    expect(commits[0]?.parents).toEqual([parent ?? ""]);
    expect(await isAncestorCommit(repo, parent ?? "", "HEAD")).toBe(true);
    expect(await isAncestorCommit(repo, "HEAD", parent ?? "")).toBe(false);
  });

  test("git commit -a などの一時インデックス（GIT_INDEX_FILE）を読む", async () => {
    const repo = await createRepository();
    await writeFile(join(repo, "a.txt"), "one\n");
    await git(repo, ["add", "a.txt"]);
    await git(repo, ["commit", "-m", "init"]);
    const parent = (await resolveHeadCommit(repo)) ?? "";

    const temporaryIndex = join(repo, ".git", "sekisyo-test-index");
    await copyFile(join(repo, ".git", "index"), temporaryIndex);
    process.env.GIT_INDEX_FILE = temporaryIndex;
    await writeFile(join(repo, "a.txt"), "only in temporary index\n");
    await git(repo, ["add", "a.txt"]);

    expect(await readStagedChangedFiles(repo, parent)).toEqual(["a.txt"]);
    const temporaryTree = await writeIndexTree(repo);

    delete process.env.GIT_INDEX_FILE;
    expect(await readStagedChangedFiles(repo, parent)).toEqual([]);
    expect(await writeIndexTree(repo)).not.toBe(temporaryTree);
  });
});
