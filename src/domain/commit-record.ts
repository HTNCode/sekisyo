import type { DiffAnalysis } from "./analysis.ts";
import type { SessionFingerprintInput } from "./fingerprint.ts";
import {
  createSessionRecord,
  transitionSession,
  type CreateSessionInput,
  type SessionRecord
} from "./session.ts";

/**
 * commit 時の通過記録を push 時の記録と区別するための remote。実在の remote 名と
 * 衝突しないよう、Git の remote 名に使えない括弧を含める。
 */
export const COMMIT_RECORD_REMOTE = "(pre-commit)";

export interface CommitRecordKey {
  /** コミットの親。ステージした時点の HEAD。 */
  readonly parent: string;
  /** ステージ済みの内容のツリー。コミット後の `<commit>^{tree}` と一致する。 */
  readonly tree: string;
  readonly policyDigest: string;
  readonly promptVersion: string;
  readonly model: string;
}

/**
 * commit 時の記録の束縛。差分の文字列ではなく「親とツリー」で照合するのは、
 * diff の表示設定（diff.mnemonicPrefix など）で commit 時と push 時の差分テキスト
 * が一致しなくても、同じ内容のコミットを確実に見つけるため。
 */
export function commitRecordBinding(
  key: CommitRecordKey
): SessionFingerprintInput {
  return {
    base: key.parent,
    head: key.tree,
    remote: COMMIT_RECORD_REMOTE,
    ref: `index@${key.tree}`,
    policyDigest: key.policyDigest,
    promptVersion: key.promptVersion,
    model: key.model
  };
}

export function isPassedSession(session: SessionRecord): boolean {
  return session.status === "passed" || session.status === "summarized";
}

/** 試問を通過したことがある記録。PR へ書き出して公開済みになったものも含む。 */
export function hasPassedExamination(session: SessionRecord): boolean {
  return isPassedSession(session) || session.status === "published";
}

export interface PassedSessionSource {
  /** PR に載る説明の見出し。短いコミット ID など。 */
  readonly label: string;
  readonly session: SessionRecord;
}

function prefixed(prefix: string, id: string): string {
  return `${prefix}-${id}`;
}

function combinedAnalysis(
  sources: readonly PassedSessionSource[],
  filesChanged: number
): DiffAnalysis {
  const analyses = sources.map((source, index) => {
    const { analysis } = source.session;
    if (analysis === null) {
      throw new Error("Passed sessions must include their analysis.");
    }
    return { analysis, label: source.label, prefix: `s${index + 1}` };
  });
  return {
    summary: analyses
      .map(({ analysis, label }) => `[${label}] ${analysis.summary}`)
      .join("\n"),
    filesChanged,
    attention: analyses.flatMap(({ analysis }) => analysis.attention),
    findings: analyses.flatMap(({ analysis, prefix }) =>
      analysis.findings.map((finding) => ({
        ...finding,
        id: prefixed(prefix, finding.id)
      }))
    ),
    risks: analyses.flatMap(({ analysis }) => analysis.risks)
  };
}

/**
 * commit 時（と前回 push 時）に通過済みの記録をまとめ、今回の push に束縛した
 * 通過済みの記録を作る。`sekisyo pr` はこの記録から PR 本文を作る。
 *
 * 質問 ID や指摘 ID は記録ごとに q1 などが重複するため、記録ごとの接頭辞を付け、
 * 回答と対応付けも同じ規則で付け替える。件数などがスキーマの上限を超える場合は
 * undefined を返し、呼び出し側は push 時の試問にフォールバックする。
 */
export function composePassedSession(
  binding: CreateSessionInput,
  sources: readonly PassedSessionSource[],
  filesChanged: number,
  now: string
): SessionRecord | undefined {
  if (
    sources.length === 0 ||
    !sources.every((s) => hasPassedExamination(s.session))
  ) {
    return undefined;
  }
  try {
    const parts = sources.map((source, index) => ({
      prefix: `s${index + 1}`,
      session: source.session
    }));
    let session = createSessionRecord(binding, now);
    session = transitionSession(session, "analyzed", now, {
      analysis: combinedAnalysis(sources, filesChanged)
    });
    session = transitionSession(session, "review_resolved", now, {
      reviewResolutions: parts.flatMap(({ prefix, session: part }) =>
        part.reviewResolutions.map((resolution) => ({
          ...resolution,
          findingId: prefixed(prefix, resolution.findingId)
        }))
      )
    });
    session = transitionSession(session, "questioning", now, {
      questions: parts.flatMap(({ prefix, session: part }) =>
        part.questions.map((question) => ({
          ...question,
          id: prefixed(prefix, question.id)
        }))
      )
    });
    return transitionSession(session, "passed", now, {
      attempts: parts.flatMap(({ prefix, session: part }) =>
        part.attempts.map((attempt) => ({
          ...attempt,
          questionId: prefixed(prefix, attempt.questionId)
        }))
      )
    });
  } catch {
    return undefined;
  }
}
