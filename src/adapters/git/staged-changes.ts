import {
  assertNotTimedOut,
  runCheckedCommandWithStdoutLimit,
  runCommand
} from "./command.ts";
import { isObjectId, runGit } from "./git-repository.ts";

// pre-commit フックの中では、Git が GIT_INDEX_FILE で一時的なインデックスを指す
// ことがある（git commit -a / git commit <path>）。ここでの git 呼び出しは環境変数を
// そのまま引き継ぐ runGit / runCommand を使い、そのインデックスを読む。

const COMMAND_TIMEOUT_MS = 30_000;

// push 時の差分（readRepositoryDiff）と同じ指定にそろえる。
const DIFF_OPTIONS = ["--no-ext-diff", "--no-textconv", "--find-renames"];

/** HEAD が無い（最初のコミット前）なら undefined を返す。 */
export async function resolveHeadCommit(
  repoRoot: string
): Promise<string | undefined> {
  const command = ["git", "rev-parse", "--verify", "--quiet", "HEAD^{commit}"];
  const result = await runCommand(command, {
    cwd: repoRoot,
    timeoutMs: COMMAND_TIMEOUT_MS
  });
  assertNotTimedOut(command, result, COMMAND_TIMEOUT_MS);
  const oid = result.stdout.trim();
  return result.exitCode === 0 && isObjectId(oid) ? oid : undefined;
}

/** ステージ済みの内容をツリーとして書き出し、その OID を返す。 */
export async function writeIndexTree(repoRoot: string): Promise<string> {
  const oid = (await runGit(repoRoot, ["write-tree"])).stdout.trim();
  if (!isObjectId(oid)) {
    throw new Error("git write-tree returned an invalid object ID.");
  }
  return oid;
}

export async function readStagedDiff(
  repoRoot: string,
  parent: string,
  maxBytes: number
): Promise<string> {
  const result = await runCheckedCommandWithStdoutLimit(
    ["git", "diff", "--cached", ...DIFF_OPTIONS, parent, "--"],
    { cwd: repoRoot, timeoutMs: COMMAND_TIMEOUT_MS },
    maxBytes
  );
  return result.stdout;
}

export async function readStagedChangedFiles(
  repoRoot: string,
  parent: string
): Promise<readonly string[]> {
  const result = await runGit(repoRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-ext-diff",
    parent,
    "--"
  ]);
  return result.stdout.split("\0").filter((path) => path.length > 0);
}

export interface CommitSummary {
  readonly oid: string;
  readonly tree: string;
  readonly parents: readonly string[];
}

/** exclude から到達できない head 側のコミットを、古い順に返す。 */
export async function listCommitsSince(
  repoRoot: string,
  head: string,
  exclude: string | undefined
): Promise<readonly CommitSummary[]> {
  const result = await runGit(repoRoot, [
    "log",
    "--reverse",
    "--format=%H %T %P",
    head,
    ...(exclude === undefined ? [] : [`^${exclude}`]),
    "--"
  ]);
  return result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [oid = "", tree = "", ...parents] = line.trim().split(" ");
      if (!isObjectId(oid) || !isObjectId(tree) || !parents.every(isObjectId)) {
        throw new Error("git log returned an invalid object ID.");
      }
      return { oid, tree, parents };
    });
}

export async function isAncestorCommit(
  repoRoot: string,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  const command = ["git", "merge-base", "--is-ancestor", ancestor, descendant];
  const result = await runCommand(command, {
    cwd: repoRoot,
    timeoutMs: COMMAND_TIMEOUT_MS
  });
  assertNotTimedOut(command, result, COMMAND_TIMEOUT_MS);
  return result.exitCode === 0;
}

/** 競合を解消したマージを `git commit` で確定しようとしている最中か。 */
export async function isMergeInProgress(repoRoot: string): Promise<boolean> {
  const command = ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"];
  const result = await runCommand(command, {
    cwd: repoRoot,
    timeoutMs: COMMAND_TIMEOUT_MS
  });
  assertNotTimedOut(command, result, COMMAND_TIMEOUT_MS);
  return result.exitCode === 0;
}
