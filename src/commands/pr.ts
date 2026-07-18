import { createPrPublisher } from "../adapters/github/ghCli.ts";
import { resolveCommit, runGit } from "../adapters/git/gitRepository.ts";
import { PROMPT_VERSION } from "../application/gate.ts";
import { createPolicyDigest, loadSekisyoConfig } from "../config/index.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type { SessionRecord } from "../domain/session.ts";
import type { GitRepository } from "../ports/git-repository.ts";
import { renderSekisyoPrBlock, upsertSekisyoBlock } from "../pr/marker.ts";
import { createSessionStore } from "./runtime.ts";

export interface PrOptions {
  readonly base?: string;
  readonly title?: string;
}

function formatLocation(
  path: string,
  startLine?: number,
  endLine?: number
): string {
  if (startLine === undefined) {
    return path;
  }
  if (endLine === undefined || endLine === startLine) {
    return `${path}:L${startLine}`;
  }
  return `${path}:L${startLine}-L${endLine}`;
}

async function currentBranch(repoRoot: string): Promise<string> {
  return (await runGit(repoRoot, ["branch", "--show-current"])).stdout.trim();
}

async function defaultBaseBranch(repoRoot: string): Promise<string> {
  try {
    const symbolic = (
      await runGit(repoRoot, [
        "symbolic-ref",
        "--quiet",
        "refs/remotes/origin/HEAD"
      ])
    ).stdout.trim();
    return symbolic.replace(/^refs\/remotes\/origin\//u, "");
  } catch {
    for (const candidate of ["main", "master"]) {
      try {
        await resolveCommit(repoRoot, `origin/${candidate}`);
        return candidate;
      } catch {
        // Try the next conventional branch.
      }
    }
    return "main";
  }
}

async function defaultTitle(repoRoot: string): Promise<string> {
  return (await runGit(repoRoot, ["log", "-1", "--pretty=%s"])).stdout.trim();
}

interface PublishableSessionBinding {
  readonly base: string;
  readonly diffDigest: string;
  readonly head: string;
  readonly model: string;
  readonly policyDigest: string;
  readonly promptVersion: string;
  readonly ref: string;
  readonly remote: string;
}

function destinationRef(ref: string): string {
  return ref.replace(/@(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu, "");
}

export function latestPublishableSession(
  sessions: readonly SessionRecord[],
  binding: PublishableSessionBinding
): SessionRecord | undefined {
  return sessions
    .filter(
      (session) =>
        session.status === "summarized" &&
        session.base === binding.base &&
        session.diffDigest === binding.diffDigest &&
        session.head === binding.head &&
        session.model === binding.model &&
        session.policyDigest === binding.policyDigest &&
        session.promptVersion === binding.promptVersion &&
        destinationRef(session.ref) === binding.ref &&
        session.remote === binding.remote
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

async function preferredRemoteBase(
  repoRoot: string,
  baseBranch: string
): Promise<string> {
  const remotes = (await runGit(repoRoot, ["remote"])).stdout
    .split(/\r?\n/u)
    .map((remote) => remote.trim())
    .filter((remote) => remote.length > 0);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (remote === undefined) {
    return baseBranch;
  }
  try {
    return await resolveCommit(
      repoRoot,
      `refs/remotes/${remote}/${baseBranch}`
    );
  } catch {
    return baseBranch;
  }
}

async function createPublishableBinding(
  repoRoot: string,
  repository: GitRepository,
  input: {
    readonly base: string;
    readonly head: string;
    readonly ref: string;
  }
): Promise<PublishableSessionBinding> {
  const state = await repository.inspect(repoRoot, {
    base: input.base,
    head: input.head,
    remoteRef: input.ref
  });
  const config = await loadSekisyoConfig(repoRoot);
  const range = {
    base: state.base,
    head: state.head,
    repoRoot: state.repoRoot,
    rootCommit: state.rootCommit
  };
  const diff = await repository.readDiff({
    ...range,
    maxBytes: config.analysis.maxDiffBytes
  });
  return {
    base: state.rootCommit ? "ROOT" : state.base,
    diffDigest: fingerprint(diff),
    head: state.head,
    model: config.model,
    policyDigest: createPolicyDigest(config),
    promptVersion: PROMPT_VERSION,
    ref: state.ref,
    remote: state.remote
  };
}

function buildPrBlock(session: SessionRecord): string {
  if (session.analysis === null || session.summary === null) {
    throw new Error(
      "PRへ書き出せる要約がありません。`sekisyo ask` を実行してください。"
    );
  }
  const questions = new Map(
    session.questions.map((question) => [question.id, question])
  );
  const findings = new Map(
    session.analysis.findings.map((finding) => [finding.id, finding])
  );
  return renderSekisyoPrBlock({
    attention: session.analysis.attention.map((item) => ({
      classification: item.classification,
      ...(item.endLine === undefined ? {} : { endLine: item.endLine }),
      location: formatLocation(item.path, item.startLine, item.endLine),
      reason: item.reason,
      ...(item.startLine === undefined ? {} : { startLine: item.startLine })
    })),
    decisions: session.summary.decisions,
    evidence: session.attempts.flatMap((attempt) => {
      if (!attempt.passed) {
        return [];
      }
      const question = questions.get(attempt.questionId);
      return question === undefined
        ? []
        : [
            {
              answer: attempt.answer,
              category: question.category,
              question: question.prompt
            }
          ];
    }),
    headOid: session.head,
    intent: session.summary.intent,
    reviewResolutions: session.reviewResolutions.map((resolution) => {
      const finding = findings.get(resolution.findingId);
      return {
        finding: finding?.title ?? resolution.findingId,
        location:
          finding === undefined
            ? "場所不明"
            : formatLocation(finding.path, finding.line),
        reason: resolution.reason
      };
    }),
    risks: session.summary.risks,
    unresolved: session.summary.unresolved,
    verification: session.summary.verification
  });
}

export async function runPrCommand(
  cwd: string,
  options: PrOptions = {}
): Promise<number> {
  const { repoRoot, repository, store } = await createSessionStore(cwd);
  const headOid = await resolveCommit(repoRoot, "HEAD");
  const headBranch = await currentBranch(repoRoot);
  if (headBranch.length === 0) {
    throw new Error("detached HEADではPRを作成できません。");
  }
  const publisher = createPrPublisher(repoRoot);
  const current = await publisher.findCurrent(repoRoot);
  if (current !== undefined && current.head !== headOid) {
    throw new Error(
      "現在のPRのHEADとローカルHEADが一致しません。最新状態を取得してから再実行してください。"
    );
  }
  const baseBranch =
    current?.base ?? options.base ?? (await defaultBaseBranch(repoRoot));
  const baseReference =
    current?.baseOid ?? (await preferredRemoteBase(repoRoot, baseBranch));
  const binding = await createPublishableBinding(repoRoot, repository, {
    base: baseReference,
    head: headOid,
    ref: `refs/heads/${headBranch}`
  });
  const session = latestPublishableSession(await store.list(), binding);
  if (session === undefined) {
    throw new Error(
      `現在のPR差分（base: ${baseBranch}）と完全に一致する要約済みの通行手形がありません。` +
        ` \`sekisyo ask --base ${baseBranch}\` を実行してください。`
    );
  }
  const rendered = buildPrBlock(session);
  let url: string;
  if (current === undefined) {
    const published = await publisher.publish({
      base: baseBranch,
      body: upsertSekisyoBlock("", rendered),
      head: headBranch,
      title: options.title ?? (await defaultTitle(repoRoot))
    });
    url = published.url;
  } else {
    await publisher.updateBody(
      current.number,
      upsertSekisyoBlock(current.body, rendered)
    );
    url = current.url;
  }

  await store.remove(session.fingerprint);
  console.log(`PRへSekisyo記録を書き出しました: ${url}`);
  console.log("役目を終えたローカルの通行手形を削除しました。");
  return 0;
}
