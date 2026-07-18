import type { SekisyoConfig } from "../config/schema.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type {
  AnswerJudgment,
  QaExchange,
  Question
} from "../domain/questions.ts";
import {
  canTransitionSession,
  createSessionRecord,
  transitionSession,
  type SessionRecord
} from "../domain/session.ts";
import type {
  DiffAnalyzer,
  QaModel,
  ReviewTarget,
  SessionStore,
  Terminal
} from "../ports/index.ts";
import { heading, muted, success, warning } from "../ui/format.ts";
import { GateError } from "./errors.ts";
import { excludedDiffPaths, resolveQuestionCategories } from "./policy.ts";

export const PROMPT_VERSION = "sekisyo-prompts-v2";

export interface GateTarget {
  readonly analysisTarget: ReviewTarget;
  readonly base: string;
  readonly changedFiles: readonly string[];
  readonly diff: string;
  readonly head: string;
  readonly policyDigest: string;
  readonly ref: string;
  readonly remote: string;
  readonly repoRoot: string;
}

export interface GateDependencies {
  readonly analyzer: DiffAnalyzer;
  readonly clock?: () => string;
  readonly model: QaModel;
  readonly store: SessionStore;
  readonly terminal?: Terminal;
}

export interface RunGateOptions {
  readonly allowReuse?: boolean;
}

function now(dependencies: GateDependencies): string {
  return dependencies.clock?.() ?? new Date().toISOString();
}

function isReusable(session: SessionRecord): boolean {
  return session.status === "passed" || session.status === "summarized";
}

async function saveTransition(
  dependencies: GateDependencies,
  session: SessionRecord,
  status: Parameters<typeof transitionSession>[1],
  changes: Parameters<typeof transitionSession>[3] = {}
): Promise<SessionRecord> {
  const updated = transitionSession(
    session,
    status,
    now(dependencies),
    changes
  );
  await dependencies.store.save(updated);
  return updated;
}

function requireTerminal(dependencies: GateDependencies): Terminal {
  if (dependencies.terminal === undefined) {
    throw new GateError(
      "interactive_terminal_required",
      "対話可能な端末がありません。先に端末で `sekisyo ask` を実行してください。"
    );
  }
  return dependencies.terminal;
}

function location(path: string, line?: number): string {
  return line === undefined ? path : `${path}:${line}`;
}

async function resolveFindings(
  dependencies: GateDependencies,
  session: SessionRecord
): Promise<SessionRecord> {
  const analysis = session.analysis;
  if (analysis === null) {
    throw new Error("Review findings require a completed analysis.");
  }
  if (analysis.findings.length === 0) {
    return saveTransition(dependencies, session, "review_resolved");
  }

  const terminal = requireTerminal(dependencies);
  terminal.write(heading(`一次セルフレビュー ${analysis.findings.length}件`));
  let current = session;

  for (const [index, finding] of analysis.findings.entries()) {
    terminal.write(
      `  [${index + 1}] ${location(finding.path, finding.line)}\n` +
        `      ${finding.title}\n      ${finding.explanation}`
    );
    if (finding.suggestion !== undefined) {
      terminal.write(muted(`      提案: ${finding.suggestion}`));
    }
    const action = await terminal.select("この指摘をどう扱いますか?", [
      {
        label: "修正するため中断",
        value: "fix",
        description: "pushせず、コードを直してから再実行します"
      },
      {
        label: "意図的な変更として理由を説明",
        value: "intentional",
        description: "具体的な設計理由を記録します"
      }
    ] as const);
    if (action === "fix") {
      throw new GateError(
        "fix_requested",
        `${location(finding.path, finding.line)} の修正を選択したため中断しました。`
      );
    }

    let reason = "";
    while (reason.length === 0) {
      reason = await terminal.prompt(
        "なぜこの挙動が意図的で、どのリスクを受け入れるのか説明してください"
      );
      if (reason.length === 0) {
        terminal.write(warning("具体的な理由を入力してください。"));
      }
    }
    current = {
      ...current,
      reviewResolutions: [
        ...current.reviewResolutions,
        {
          action: "intentional",
          findingId: finding.id,
          reason,
          resolvedAt: now(dependencies)
        }
      ],
      updatedAt: now(dependencies)
    };
    await dependencies.store.save(current);
  }

  return saveTransition(dependencies, current, "review_resolved");
}

function answerJudgmentFromAttempt(
  attempt: SessionRecord["attempts"][number]
): AnswerJudgment {
  return {
    passed: attempt.passed,
    feedback: attempt.feedback,
    ...(attempt.missingConcept === undefined
      ? {}
      : { missingConcept: attempt.missingConcept })
  };
}

function exchangesForSession(session: SessionRecord): readonly QaExchange[] {
  const questions = new Map(
    session.questions.map((question) => [question.id, question])
  );
  return session.attempts.flatMap((attempt) => {
    const question = questions.get(attempt.questionId);
    return question === undefined
      ? []
      : [
          {
            answer: attempt.answer,
            judgment: answerJudgmentFromAttempt(attempt),
            question
          }
        ];
  });
}

async function askOneQuestion(
  dependencies: GateDependencies,
  session: SessionRecord,
  initialQuestion: Question,
  maxFollowUps: number
): Promise<SessionRecord> {
  const terminal = requireTerminal(dependencies);
  let current = session;
  let question = initialQuestion;

  for (let followUpCount = 0; ; followUpCount += 1) {
    terminal.write(
      `\n[${question.category}] ${question.prompt}\n` +
        muted(`ねらい: ${question.learningObjective}`)
    );
    let answer = "";
    while (answer.length === 0) {
      answer = await terminal.prompt("あなたの説明");
      if (answer.length === 0) {
        terminal.write(warning("回答を入力してください。"));
      }
    }
    const judgment = await dependencies.model.judgeAnswer({
      answer,
      question
    });
    current = {
      ...current,
      attempts: [
        ...current.attempts,
        {
          answer,
          attemptedAt: now(dependencies),
          feedback: judgment.feedback,
          ...(judgment.missingConcept === undefined
            ? {}
            : { missingConcept: judgment.missingConcept }),
          passed: judgment.passed,
          questionId: question.id
        }
      ],
      updatedAt: now(dependencies)
    };
    await dependencies.store.save(current);
    terminal.write(
      judgment.passed
        ? success(`通過: ${judgment.feedback}`)
        : warning(`再確認: ${judgment.feedback}`)
    );
    if (judgment.passed) {
      return current;
    }
    if (followUpCount >= maxFollowUps) {
      const failed = await saveTransition(dependencies, current, "failed");
      throw new GateError(
        "follow_ups_exhausted",
        `回答の具体性が基準に届きませんでした（記録: ${failed.fingerprint.slice(0, 12)}）。変更を確認して再実行してください。`
      );
    }

    const followUp = await dependencies.model.generateFollowUp({
      answer,
      judgment,
      question
    });
    if (followUp === null) {
      const failed = await saveTransition(dependencies, current, "failed");
      throw new GateError(
        "follow_ups_exhausted",
        `追撃質問を生成できませんでした（記録: ${failed.fingerprint.slice(0, 12)}）。`
      );
    }
    if (current.questions.some((item) => item.id === followUp.id)) {
      throw new Error(`追撃質問のIDが重複しています: ${followUp.id}`);
    }
    if (followUp.category !== question.category) {
      throw new Error(
        `追撃質問のカテゴリが元の質問と一致しません: ${question.category} -> ${followUp.category}`
      );
    }
    question = followUp;
    current = {
      ...current,
      questions: [...current.questions, followUp],
      updatedAt: now(dependencies)
    };
    await dependencies.store.save(current);
  }
}

async function summarizePassedSession(
  dependencies: GateDependencies,
  session: SessionRecord
): Promise<SessionRecord> {
  if (session.status === "summarized") {
    return session;
  }
  if (session.status !== "passed" || session.analysis === null) {
    throw new Error("Only a passed session can be summarized.");
  }
  const summary = await dependencies.model.summarize({
    analysis: session.analysis,
    exchanges: exchangesForSession(session)
  });
  return saveTransition(dependencies, session, "summarized", { summary });
}

export async function ensureSessionSummary(
  dependencies: GateDependencies,
  session: SessionRecord
): Promise<SessionRecord> {
  return summarizePassedSession(dependencies, session);
}

export async function runGate(
  dependencies: GateDependencies,
  config: SekisyoConfig,
  target: GateTarget,
  options: RunGateOptions = {}
): Promise<SessionRecord> {
  const exactDiff = target.diff;
  if (exactDiff.trim().length === 0) {
    throw new GateError("no_changes", "確認対象の差分がありません。");
  }
  const excluded = excludedDiffPaths(
    target.changedFiles,
    config.privacy.exclude
  );
  if (excluded.length > 0) {
    throw new GateError(
      "privacy_exclusion",
      `秘密情報として除外されたパスが差分に含まれます: ${excluded.join(", ")}`
    );
  }

  const created = createSessionRecord(
    {
      base: target.base,
      diffDigest: fingerprint(exactDiff),
      head: target.head,
      model: config.model,
      policyDigest: target.policyDigest,
      promptVersion: PROMPT_VERSION,
      ref: target.ref,
      remote: target.remote
    },
    now(dependencies)
  );
  const existing = await dependencies.store.load(created.fingerprint);
  if (
    options.allowReuse !== false &&
    existing !== null &&
    existing.diffDigest === created.diffDigest &&
    isReusable(existing)
  ) {
    return existing.status === "passed"
      ? summarizePassedSession(dependencies, existing)
      : existing;
  }

  let session = created;
  await dependencies.store.save(session);
  const terminal = requireTerminal(dependencies);
  terminal.write("sekisyo: 差分を分析中... (codex exec)");
  const analysis = await dependencies.analyzer.analyze({
    diff: exactDiff,
    excludedPaths: config.privacy.exclude,
    head: target.head,
    repositoryPath: target.repoRoot,
    target: target.analysisTarget
  });
  session = await saveTransition(dependencies, session, "analyzed", {
    analysis
  });
  session = await resolveFindings(dependencies, session);

  const categories = resolveQuestionCategories(
    config,
    analysis,
    target.changedFiles
  );
  const requiredCount = categories.filter(
    (category) => category.required
  ).length;
  if (requiredCount > config.questions.count) {
    throw new Error(
      `必須質問カテゴリが${requiredCount}件あります。questions.countを${requiredCount}以上にしてください。`
    );
  }
  const questions = await dependencies.model.generateQuestions({
    analysis,
    categories,
    questionCount: config.questions.count
  });
  const missingRequired = categories
    .filter((category) => category.required)
    .filter(
      (category) =>
        !questions.some((question) => question.category === category.name)
    )
    .map((category) => category.name);
  if (missingRequired.length > 0) {
    throw new Error(
      `必須質問カテゴリが生成結果にありません: ${missingRequired.join(", ")}`
    );
  }
  session = await saveTransition(dependencies, session, "questioning", {
    questions: [...questions]
  });
  terminal.write(heading(`口頭試問 ${questions.length}問`));

  for (const question of questions) {
    session = await askOneQuestion(
      dependencies,
      session,
      question,
      config.questions.maxFollowUps
    );
  }
  session = await saveTransition(dependencies, session, "passed");
  session = await summarizePassedSession(dependencies, session);
  terminal.write(heading("通過"));
  terminal.write(success("説明責任の記録を保存しました。pushを続行できます。"));
  return session;
}

export async function markSessionFailed(
  dependencies: GateDependencies,
  session: SessionRecord
): Promise<SessionRecord> {
  if (!canTransitionSession(session.status, "failed")) {
    return session;
  }
  return saveTransition(dependencies, session, "failed");
}
