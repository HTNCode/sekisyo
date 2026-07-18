export interface InspectRepositoryOptions {
  readonly remote?: string;
  readonly remoteRef?: string;
  readonly head?: string;
  readonly base?: string;
  readonly prBase?: string;
  /**
   * Previously resolved absolute repository root. Internal callers can pass
   * this to avoid repeating repository discovery.
   */
  readonly repoRoot?: string;
  /**
   * Exact remote destination OID used only when no explicit, PR, or remote
   * default base can be resolved.
   */
  readonly fallbackBase?: string;
}

export interface RepositoryState {
  readonly repoRoot: string;
  readonly base: string;
  readonly diffBase: string;
  readonly head: string;
  readonly remote: string;
  readonly ref: string;
  /**
   * True when `head` is a root commit. In that case `base` is equal to
   * `head`; callers must analyze the commit itself instead of a base range.
   */
  readonly rootCommit: boolean;
}

export interface RepositoryRange {
  readonly repoRoot: string;
  readonly base: string;
  readonly diffBase?: string;
  readonly head: string;
  readonly rootCommit?: boolean;
}

export interface RepositoryDiffTarget extends RepositoryRange {
  readonly maxBytes: number;
}

export interface GitRepository {
  inspect(
    cwd: string,
    options?: InspectRepositoryOptions
  ): Promise<RepositoryState>;
  readDiff(target: RepositoryDiffTarget): Promise<string>;
  changedFiles(target: RepositoryRange): Promise<readonly string[]>;
  gitPath(path: string, repoRoot?: string): Promise<string>;
  passthrough(args: readonly string[]): Promise<number>;
}
