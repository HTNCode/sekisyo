import { isZeroObjectId } from "../adapters/git/git-repository.ts";
import {
  isAncestorCommit,
  listCommitsSince,
  type CommitSummary
} from "../adapters/git/staged-changes.ts";
import { PROMPT_VERSION } from "../application/gate.ts";
import { configQaModelDescriptor } from "../config/model.ts";
import {
  commitRecordBinding,
  composePassedSession,
  hasPassedExamination,
  isPassedSession,
  type PassedSessionSource
} from "../domain/commit-record.ts";
import { createSessionFingerprint } from "../domain/fingerprint.ts";
import type { SessionRecord } from "../domain/session.ts";
import { destinationRef } from "./pr.ts";
import type { PreparedGateContext } from "./runtime.ts";

export interface PushUpdate {
  readonly localOid: string;
  readonly remoteOid: string;
}

export interface CommitCoverageGit {
  readonly isAncestor: (
    repoRoot: string,
    ancestor: string,
    descendant: string
  ) => Promise<boolean>;
  readonly listCommits: (
    repoRoot: string,
    head: string,
    exclude: string | undefined
  ) => Promise<readonly CommitSummary[]>;
}

const DEFAULT_GIT: CommitCoverageGit = {
  isAncestor: isAncestorCommit,
  listCommits: listCommitsSince
};

/** 今回の push と同じ base・宛先・方針で、remote の現在の head を通過させた記録。 */
async function findPreviousPushRecord(
  context: PreparedGateContext,
  remoteOid: string,
  model: string
): Promise<SessionRecord | undefined> {
  const { target } = context;
  return (await context.store.list())
    .filter(
      (session) =>
        hasPassedExamination(session) &&
        session.head === remoteOid &&
        session.base === target.base &&
        session.remote === target.remote &&
        destinationRef(session.ref) === destinationRef(target.ref) &&
        session.policyDigest === target.policyDigest &&
        session.promptVersion === PROMPT_VERSION &&
        session.model === model
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * push 範囲のコミットがすべて commit 時の試問を通過していれば、それらをまとめた
 * 通過記録を今回の push に束縛して保存し、返す。1つでも欠ければ undefined を
 * 返し、呼び出し側は通常どおり push 時の試問を行う。
 *
 * remote に既にあるコミットは、remote の head を通過させた前回の push 記録で
 * まかなう。そうしないと、エージェントのコミットや commit 時の試問を有効にする
 * 前のコミットが1つあるだけで、そのブランチの以後の push が毎回試問になる。
 */
export async function coverPushWithCommitRecords(
  context: PreparedGateContext,
  update: PushUpdate,
  now: string,
  git: CommitCoverageGit = DEFAULT_GIT
): Promise<SessionRecord | undefined> {
  const { config, store, target } = context;
  if (config.triggers?.commit !== true || target.base === "ROOT") {
    return undefined;
  }
  const model = configQaModelDescriptor(config);
  const sources: PassedSessionSource[] = [];

  let exclude = target.base;
  if (!isZeroObjectId(update.remoteOid)) {
    if (
      !(await git.isAncestor(
        target.repoRoot,
        update.remoteOid,
        update.localOid
      ))
    ) {
      return undefined;
    }
    const previous = await findPreviousPushRecord(
      context,
      update.remoteOid,
      model
    );
    if (previous === undefined) {
      return undefined;
    }
    sources.push({ label: "前回のpush", session: previous });
    exclude = update.remoteOid;
  }

  const commits = await git.listCommits(
    target.repoRoot,
    update.localOid,
    exclude
  );
  if (commits.length === 0) {
    return undefined;
  }
  for (const commit of commits) {
    const [parent, ...otherParents] = commit.parents;
    if (parent === undefined || otherParents.length > 0) {
      return undefined;
    }
    const record = await store.load(
      createSessionFingerprint(
        commitRecordBinding({
          parent,
          tree: commit.tree,
          policyDigest: target.policyDigest,
          promptVersion: PROMPT_VERSION,
          model
        })
      )
    );
    if (record === null || !isPassedSession(record)) {
      return undefined;
    }
    sources.push({ label: commit.oid.slice(0, 7), session: record });
  }

  const composed = composePassedSession(
    {
      base: target.base,
      diffDigest: target.diffDigest,
      head: target.head,
      model,
      policyDigest: target.policyDigest,
      promptVersion: PROMPT_VERSION,
      ref: target.ref,
      remote: target.remote
    },
    sources,
    target.changedFiles.length,
    now
  );
  if (composed !== undefined) {
    await store.save(composed);
  }
  return composed;
}
