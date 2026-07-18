import { isAbsolute } from "node:path";
import type {
  GitRepository,
  InspectRepositoryOptions,
  RepositoryDiffTarget,
  RepositoryRange,
  RepositoryState
} from "../../ports/git-repository.ts";
import type { PrPublisher } from "../../ports/pr-publisher.ts";
import {
  runCheckedCommand,
  runCommand,
  runInheritedCommand
} from "./command.ts";
import {
  isObjectId,
  isZeroObjectId,
  readChangedFiles,
  readRepositoryDiff,
  resolveDiffBase
} from "./gitRepository.ts";

const COMMAND_TIMEOUT_MS = 30_000;

export interface GitCliRepositoryOptions {
  readonly cwd?: string;
  readonly prPublisher?: Pick<PrPublisher, "findCurrent">;
}

function assertReference(value: string, label: string): string {
  const reference = value.trim();
  if (
    reference.length === 0 ||
    reference.length > 4_096 ||
    reference.startsWith("-") ||
    reference.includes("\0") ||
    reference.includes("\r") ||
    reference.includes("\n")
  ) {
    throw new Error(`${label} is not a safe Git reference.`);
  }
  return reference;
}

function assertPrivatePath(path: string): void {
  const segments = path.split(/[\\/]/);
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    segments.includes("..") ||
    path.includes("\0") ||
    path.includes("\r") ||
    path.includes("\n")
  ) {
    throw new Error("Git private path must stay inside the Git directory.");
  }
}

function assertRepositoryRoot(path: string): string {
  const repoRoot = path.trim();
  if (
    repoRoot.length === 0 ||
    !isAbsolute(repoRoot) ||
    repoRoot.includes("\0") ||
    repoRoot.includes("\r") ||
    repoRoot.includes("\n")
  ) {
    throw new Error("Repository root must be an absolute path.");
  }
  return repoRoot;
}

export class GitCliRepository implements GitRepository {
  readonly #cwd: string;
  readonly #prPublisher: Pick<PrPublisher, "findCurrent"> | undefined;

  public constructor(options: GitCliRepositoryOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#prPublisher = options.prPublisher;
  }

  async #git(
    cwd: string,
    args: readonly string[]
  ): Promise<{
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
  }> {
    return runCommand(["git", ...args], {
      cwd,
      timeoutMs: COMMAND_TIMEOUT_MS
    });
  }

  async #resolveCommit(
    repoRoot: string,
    reference: string
  ): Promise<string | undefined> {
    const safeReference = assertReference(reference, "Commit reference");
    const result = await this.#git(repoRoot, [
      "rev-parse",
      "--verify",
      `${safeReference}^{commit}`
    ]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const oid = result.stdout.trim();
    if (!isObjectId(oid)) {
      throw new Error(`Git returned an invalid object ID for ${reference}.`);
    }
    return oid;
  }

  async #resolveRequiredCommit(
    repoRoot: string,
    reference: string
  ): Promise<string> {
    const oid = await this.#resolveCommit(repoRoot, reference);
    if (oid === undefined) {
      throw new Error(`Unable to resolve commit reference: ${reference}`);
    }
    return oid;
  }

  async #currentRef(repoRoot: string): Promise<string> {
    const result = await this.#git(repoRoot, [
      "symbolic-ref",
      "--quiet",
      "HEAD"
    ]);
    const reference = result.stdout.trim();
    if (result.exitCode !== 0 || reference.length === 0) {
      throw new Error(
        "Detached HEAD requires an explicit remote destination ref."
      );
    }
    return reference;
  }

  async #remoteName(
    repoRoot: string,
    requestedRemote: string | undefined
  ): Promise<string> {
    if (requestedRemote !== undefined) {
      return assertReference(requestedRemote, "Remote");
    }

    const result = await this.#git(repoRoot, ["remote"]);
    if (result.exitCode !== 0) {
      throw new Error("Unable to list Git remotes.");
    }
    const remotes = result.stdout
      .split(/\r?\n/)
      .map((remote) => remote.trim())
      .filter((remote) => remote.length > 0);
    return remotes.includes("origin") ? "origin" : (remotes[0] ?? "local");
  }

  async #trackingCommit(
    repoRoot: string,
    remote: string,
    branch: string
  ): Promise<string | undefined> {
    if (remote === "local") {
      return undefined;
    }
    const headPrefix = "refs/heads/";
    const remotePrefix = `refs/remotes/${remote}/`;
    const normalizedBranch = branch.startsWith(headPrefix)
      ? branch.slice(headPrefix.length)
      : branch.startsWith(remotePrefix)
        ? branch.slice(remotePrefix.length)
        : branch;
    return this.#resolveCommit(
      repoRoot,
      `refs/remotes/${remote}/${normalizedBranch}`
    );
  }

  async #pullRequestBase(
    repoRoot: string,
    explicitPrBase: string | undefined
  ): Promise<string | undefined> {
    if (explicitPrBase !== undefined) {
      return assertReference(explicitPrBase, "PR base");
    }
    if (this.#prPublisher === undefined) {
      return undefined;
    }
    try {
      const pullRequest = await this.#prPublisher.findCurrent(repoRoot);
      return pullRequest?.baseOid ?? pullRequest?.base;
    } catch {
      // PR discovery is an optional hint; Git-host-independent fallback follows.
      return undefined;
    }
  }

  async #remoteDefaultCommit(
    repoRoot: string,
    remote: string
  ): Promise<string | undefined> {
    if (remote === "local") {
      return undefined;
    }
    const remoteHead = await this.#git(repoRoot, [
      "symbolic-ref",
      "--quiet",
      `refs/remotes/${remote}/HEAD`
    ]);
    if (remoteHead.exitCode === 0 && remoteHead.stdout.trim().length > 0) {
      const oid = await this.#resolveCommit(repoRoot, remoteHead.stdout.trim());
      if (oid !== undefined) {
        return oid;
      }
    }

    return (
      (await this.#trackingCommit(repoRoot, remote, "main")) ??
      (await this.#trackingCommit(repoRoot, remote, "master"))
    );
  }

  async #resolveBase(
    repoRoot: string,
    head: string,
    remote: string,
    options: InspectRepositoryOptions
  ): Promise<{ readonly base: string; readonly rootCommit: boolean }> {
    if (options.base !== undefined) {
      const base =
        (await this.#resolveCommit(repoRoot, options.base)) ??
        (await this.#trackingCommit(repoRoot, remote, options.base));
      if (base === undefined) {
        throw new Error(`Unable to resolve explicit base: ${options.base}`);
      }
      return { base, rootCommit: false };
    }

    const prBase = await this.#pullRequestBase(repoRoot, options.prBase);
    if (prBase !== undefined) {
      const base =
        (await this.#trackingCommit(repoRoot, remote, prBase)) ??
        (await this.#resolveCommit(repoRoot, prBase));
      if (base !== undefined) {
        return { base, rootCommit: false };
      }
    }

    const remoteBase = await this.#remoteDefaultCommit(repoRoot, remote);
    if (remoteBase !== undefined) {
      return { base: remoteBase, rootCommit: false };
    }

    if (options.fallbackBase !== undefined) {
      if (
        !isObjectId(options.fallbackBase) ||
        isZeroObjectId(options.fallbackBase)
      ) {
        throw new Error("Fallback base must be a nonzero Git object ID.");
      }
      const base = await this.#resolveCommit(repoRoot, options.fallbackBase);
      if (base === undefined) {
        throw new Error(
          `Unable to resolve remote fallback base: ${options.fallbackBase}`
        );
      }
      return { base, rootCommit: false };
    }

    const parent = await this.#resolveCommit(repoRoot, `${head}^`);
    if (parent !== undefined) {
      return { base: parent, rootCommit: false };
    }

    const commit = await runCheckedCommand(["git", "cat-file", "-p", head], {
      cwd: repoRoot,
      timeoutMs: COMMAND_TIMEOUT_MS
    });
    const commitHeaders = commit.stdout.split(/\r?\n\r?\n/, 1)[0] ?? "";
    if (/^parent [0-9a-f]+$/m.test(commitHeaders)) {
      throw new Error(
        "The commit has a parent that is unavailable locally; fetch history or pass --base."
      );
    }
    return { base: head, rootCommit: true };
  }

  public async inspect(
    cwd: string,
    options: InspectRepositoryOptions = {}
  ): Promise<RepositoryState> {
    const repoRoot =
      options.repoRoot ??
      (
        await runCheckedCommand(["git", "rev-parse", "--show-toplevel"], {
          cwd,
          timeoutMs: COMMAND_TIMEOUT_MS
        })
      ).stdout.trim();
    const safeRepoRoot = assertRepositoryRoot(repoRoot);
    const [remote, head, ref] = await Promise.all([
      this.#remoteName(safeRepoRoot, options.remote),
      this.#resolveRequiredCommit(safeRepoRoot, options.head ?? "HEAD"),
      options.remoteRef === undefined
        ? this.#currentRef(safeRepoRoot)
        : Promise.resolve(assertReference(options.remoteRef, "Remote ref"))
    ]);
    const [refCheck, resolvedBase] = await Promise.all([
      this.#git(safeRepoRoot, ["check-ref-format", ref]),
      this.#resolveBase(safeRepoRoot, head, remote, options)
    ]);
    if (refCheck.exitCode !== 0) {
      throw new Error(`Invalid remote destination ref: ${ref}`);
    }
    const range = {
      base: resolvedBase.base,
      head,
      repoRoot: safeRepoRoot,
      rootCommit: resolvedBase.rootCommit
    };
    const diffBase = await resolveDiffBase(range);

    return {
      ...range,
      diffBase,
      remote,
      ref
    };
  }

  public readDiff(target: RepositoryDiffTarget): Promise<string> {
    return readRepositoryDiff(target);
  }

  public changedFiles(target: RepositoryRange): Promise<readonly string[]> {
    return readChangedFiles(target);
  }

  public async gitPath(path: string, repoRoot?: string): Promise<string> {
    assertPrivatePath(path);
    const root =
      repoRoot === undefined
        ? (
            await runCheckedCommand(["git", "rev-parse", "--show-toplevel"], {
              cwd: this.#cwd,
              timeoutMs: COMMAND_TIMEOUT_MS
            })
          ).stdout.trim()
        : assertRepositoryRoot(repoRoot);
    const result = await runCheckedCommand(
      ["git", "rev-parse", "--path-format=absolute", "--git-path", path],
      { cwd: root, timeoutMs: COMMAND_TIMEOUT_MS }
    );
    return result.stdout.trim();
  }

  public passthrough(args: readonly string[]): Promise<number> {
    return runInheritedCommand(["git", ...args], { cwd: this.#cwd });
  }
}

export function createGitRepository(
  options: GitCliRepositoryOptions = {}
): GitCliRepository {
  return new GitCliRepository(options);
}
