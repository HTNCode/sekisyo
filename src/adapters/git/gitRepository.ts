import {
  runCheckedCommand,
  runCheckedCommandWithStdoutLimit,
  type CommandResult
} from "./command.ts";
import type { RepositoryRange } from "../../ports/git-repository.ts";

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export interface DiffRequest {
  readonly baseOid: string;
  readonly headOid: string;
  readonly maxBytes: number;
  readonly repoRoot: string;
}

export function isObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}

export function isZeroObjectId(value: string): boolean {
  return /^(?:0{40}|0{64})$/.test(value);
}

export async function runGit(
  repoRoot: string,
  args: readonly string[],
  stdin?: string
): Promise<CommandResult> {
  return runCheckedCommand(["git", ...args], {
    cwd: repoRoot,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 30_000
  });
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

export async function getGitPath(
  repoRoot: string,
  path: string
): Promise<string> {
  const result = await runGit(repoRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    path
  ]);
  return result.stdout.trim();
}

export async function resolveCommit(
  repoRoot: string,
  reference: string
): Promise<string> {
  const result = await runGit(repoRoot, [
    "rev-parse",
    "--verify",
    `${reference}^{commit}`
  ]);
  const oid = result.stdout.trim();
  if (!isObjectId(oid)) {
    throw new Error(`Git returned an invalid object ID for ${reference}.`);
  }
  return oid;
}

export async function findMergeBase(
  repoRoot: string,
  baseOid: string,
  headOid: string
): Promise<string> {
  if (!isObjectId(baseOid) || !isObjectId(headOid)) {
    throw new Error("A valid base and head object ID are required.");
  }
  const result = await runGit(repoRoot, ["merge-base", baseOid, headOid]);
  const mergeBaseOid = result.stdout.trim();
  if (!isObjectId(mergeBaseOid)) {
    throw new Error("Git returned an invalid merge-base object ID.");
  }
  return mergeBaseOid;
}

async function findEmptyTree(repoRoot: string): Promise<string> {
  const result = await runGit(
    repoRoot,
    ["hash-object", "-t", "tree", "--stdin"],
    ""
  );
  const oid = result.stdout.trim();
  if (!isObjectId(oid)) {
    throw new Error("Git returned an invalid empty-tree object ID.");
  }
  return oid;
}

async function resolveDiffBase(target: RepositoryRange): Promise<string> {
  if (!isObjectId(target.base) || !isObjectId(target.head)) {
    throw new Error("A valid base and head object ID are required.");
  }
  if (target.rootCommit === true) {
    if (target.base !== target.head) {
      throw new Error("A root-commit range must bind base to head.");
    }
    return findEmptyTree(target.repoRoot);
  }
  return findMergeBase(target.repoRoot, target.base, target.head);
}

export async function readDiff(request: DiffRequest): Promise<string> {
  if (!isObjectId(request.baseOid) || !isObjectId(request.headOid)) {
    throw new Error("A valid base and head object ID are required.");
  }
  if (request.maxBytes < 1) {
    throw new Error("maxBytes must be greater than zero.");
  }

  const mergeBaseOid = await findMergeBase(
    request.repoRoot,
    request.baseOid,
    request.headOid
  );
  const result = await runCheckedCommandWithStdoutLimit(
    [
      "git",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      mergeBaseOid,
      request.headOid,
      "--"
    ],
    { cwd: request.repoRoot, timeoutMs: 30_000 },
    request.maxBytes
  );
  return result.stdout;
}

export async function readRepositoryDiff(request: {
  readonly base: string;
  readonly head: string;
  readonly maxBytes: number;
  readonly repoRoot: string;
  readonly rootCommit?: boolean;
}): Promise<string> {
  if (request.maxBytes < 1) {
    throw new Error("maxBytes must be greater than zero.");
  }

  const diffBase = await resolveDiffBase(request);
  const result = await runCheckedCommandWithStdoutLimit(
    [
      "git",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      diffBase,
      request.head,
      "--"
    ],
    { cwd: request.repoRoot, timeoutMs: 30_000 },
    request.maxBytes
  );
  return result.stdout;
}

export async function readChangedFiles(
  target: RepositoryRange
): Promise<readonly string[]> {
  const diffBase = await resolveDiffBase(target);
  const result = await runGit(target.repoRoot, [
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    diffBase,
    target.head,
    "--"
  ]);

  return result.stdout.split("\0").filter((path) => path.length > 0);
}
