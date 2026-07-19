import type { SekisyoConfig } from "../config/schema.ts";
import type { ReviewFinding } from "../domain/analysis.ts";
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
import {
  formatReviewReason,
  validateReviewReasonField,
  type ReviewReasonField,
  type ReviewReasonParts
} from "./review-reason.ts";

export const PROMPT_VERSION = "sekisyo-prompts-v4";

export interface GateTarget {
  readonly analysisTarget: ReviewTarget;
  readonly base: string;
  readonly changedFiles: readonly string[];
  readonly diff: string;
  readonly diffDigest: string;
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

type TransitionDependencies = Pick<GateDependencies, "clock" | "store">;

export type SessionSummaryDependencies = Pick<
  GateDependencies,
  "clock" | "model" | "store"
>;

export interface EnsureSessionSummaryOptions {
  readonly validateBeforeSave?: (
    summarizedSession: SessionRecord
  ) => Promise<void> | void;
}

type SettledResult<Value> =
  | {
      readonly status: "fulfilled";
      readonly value: Value;
    }
  | {
      readonly error: unknown;
      readonly status: "rejected";
    };

function now(dependencies: Pick<GateDependencies, "clock">): string {
  return dependencies.clock?.() ?? new Date().toISOString();
}

function isReusable(session: SessionRecord): boolean {
  return session.status === "passed" || session.status === "summarized";
}

async function saveTransition(
  dependencies: TransitionDependencies,
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

function settle<Value>(promise: Promise<Value>): Promise<SettledResult<Value>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (error: unknown) => ({ error, status: "rejected" })
  );
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

const MAX_REVIEW_REASON_ATTEMPTS_BEFORE_CHOICE = 3;
const MAX_REVIEW_REASON_JUDGMENTS = 2;

function fixRequestedError(path: string): GateError {
  return new GateError(
    "fix_requested",
    `${path} の修正を選択したため中断しました。`
  );
}

async function promptReviewReasonField(
  terminal: Terminal,
  field: ReviewReasonField,
  message: string,
  findingPath: string
): Promise<string> {
  let failedAttempts = 0;
  while (true) {
    const candidate = await terminal.prompt(
      `${message}（修正に切り替える場合は :fix）`
    );
    if (candidate.trim().toLowerCase() === ":fix") {
      throw fixRequestedError(findingPath);
    }
    const validation = validateReviewReasonField(field, candidate);
    if (validation.valid) {
      return validation.value;
    }
    terminal.write(warning(validation.message));
    failedAttempts += 1;
    if (failedAttempts < MAX_REVIEW_REASON_ATTEMPTS_BEFORE_CHOICE) {
      continue;
    }
    const retryAction = await terminal.select("次の操作を選択してください", [
      {
        label: "説明を再入力",
        value: "retry",
        description: "不足している要素を補って再入力します"
      },
      {
        label: "修正するため中断",
        value: "fix",
        description: "pushせず、コードを直してから再実行します"
      }
    ] as const);
    if (retryAction === "fix") {
      throw fixRequestedError(findingPath);
    }
    failedAttempts = 0;
  }
}

async function collectReviewReason(
  terminal: Terminal,
  findingPath: string
): Promise<string> {
  const reasonParts: ReviewReasonParts = {
    scope: await promptReviewReasonField(
      terminal,
      "scope",
      "この挙動が意図的である適用範囲・仕様・制約を説明してください",
      findingPath
    ),
    outcome: await promptReviewReasonField(
      terminal,
      "outcome",
      "その条件で起きる結果と、利用者や後続処理への影響を説明してください",
      findingPath
    ),
    handling: await promptReviewReasonField(
      terminal,
      "handling",
      "その影響をどう回避・軽減・検証・限定するか、または許容する根拠を説明してください",
      findingPath
    )
  };
  return formatReviewReason(reasonParts);
}

function reviewReasonQuestion(
  finding: ReviewFinding,
  findingPath: string
): Question {
  return {
    category: "custom",
    evidence: [
      findingPath,
      finding.title,
      finding.explanation,
      ...(finding.suggestion === undefined ? [] : [finding.suggestion])
    ],
    id: `self-review-${finding.id}`.slice(0, 200),
    learningObjective:
      "指摘された挙動について、適用範囲、具体的な結果、リスク対応を区別して説明できる",
    prompt:
      `${findingPath} の「${finding.title}」を意図的な変更として扱う説明が、` +
      "指摘内容に対応し、具体的な仕様・影響・リスク対応を示しているか確認してください。",
    rubric: [
      "適用範囲・仕様が指摘対象に結び付いている",
      "結果・影響が否定や一般論ではなく具体的である",
      "対応・判断が実施しない対策や根拠のない許容になっていない",
      "3項目が同じ文のコピーではなく、それぞれの観点を説明している"
    ]
  };
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
      throw fixRequestedError(location(finding.path, finding.line));
    }

    const findingPath = location(finding.path, finding.line);
    const question = reviewReasonQuestion(finding, findingPath);
    let reason: string | undefined;
    for (
      let judgmentAttempt = 0;
      judgmentAttempt < MAX_REVIEW_REASON_JUDGMENTS;
      judgmentAttempt += 1
    ) {
      const candidate = await collectReviewReason(terminal, findingPath);
      const judgment = await dependencies.model.judgeAnswer({
        answer: candidate,
        question
      });
      assertJudgmentCorrelation(judgment);
      terminal.write(
        judgment.passed
          ? success(`説明確認: ${judgment.feedback}`)
          : warning(`説明を再確認してください: ${judgment.feedback}`)
      );
      if (judgment.passed) {
        reason = candidate;
        break;
      }
      if (judgment.followUp !== undefined) {
        terminal.write(muted(`確認ポイント: ${judgment.followUp}`));
      }
    }
    if (reason === undefined) {
      throw new GateError(
        "review_reason_exhausted",
        `${findingPath} の説明が指摘内容と結び付きませんでした。変更を確認して再実行してください。`
      );
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

function assertJudgmentCorrelation(judgment: AnswerJudgment): void {
  const includesMissingConcept = judgment.missingConcept !== undefined;
  const includesFollowUp = judgment.followUp !== undefined;
  if (
    (judgment.passed && (includesMissingConcept || includesFollowUp)) ||
    (!judgment.passed && (!includesMissingConcept || !includesFollowUp))
  ) {
    throw new Error(
      "Answer judgment does not satisfy the passed/follow-up contract."
    );
  }
}

function createFollowUpQuestion(
  existingQuestions: readonly Question[],
  source: Question,
  prompt: string
): Question {
  const existingIds = new Set(existingQuestions.map((question) => question.id));
  let sequence = 1;
  while (existingIds.has(`follow-up-${sequence}`)) {
    sequence += 1;
  }

  return {
    category: source.category,
    evidence: [...source.evidence],
    id: `follow-up-${sequence}`,
    learningObjective: source.learningObjective,
    prompt,
    rubric: [...source.rubric]
  };
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
    assertJudgmentCorrelation(judgment);
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

    if (judgment.followUp === undefined) {
      throw new Error("Failed answer judgment did not include a follow-up.");
    }
    const followUp = createFollowUpQuestion(
      current.questions,
      question,
      judgment.followUp
    );
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
  dependencies: SessionSummaryDependencies,
  session: SessionRecord,
  options: EnsureSessionSummaryOptions
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
  const summarizedSession = transitionSession(
    session,
    "summarized",
    now(dependencies),
    { summary }
  );
  await options.validateBeforeSave?.(summarizedSession);
  await dependencies.store.save(summarizedSession);
  return summarizedSession;
}

export async function ensureSessionSummary(
  dependencies: SessionSummaryDependencies,
  session: SessionRecord,
  options: EnsureSessionSummaryOptions = {}
): Promise<SessionRecord> {
  return summarizePassedSession(dependencies, session, options);
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
      diffDigest: target.diffDigest,
      head: target.head,
      model: config.model,
      policyDigest: target.policyDigest,
      promptVersion: PROMPT_VERSION,
      ref: target.ref,
      remote: target.remote
    },
    now(dependencies)
  );
  const existing =
    options.allowReuse === false
      ? null
      : await dependencies.store.load(created.fingerprint);
  if (
    existing !== null &&
    existing.diffDigest === created.diffDigest &&
    isReusable(existing)
  ) {
    return existing;
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
  const questionGenerationController = new AbortController();
  const questionGeneration = settle(
    dependencies.model.generateQuestions(
      {
        analysis,
        categories,
        questionCount: config.questions.count
      },
      questionGenerationController.signal
    )
  );
  try {
    session = await resolveFindings(dependencies, session);
  } catch (error) {
    questionGenerationController.abort();
    // settle() already observes rejection; awaiting here could delay fix_requested
    // indefinitely when a model adapter ignores AbortSignal.
    throw error;
  }
  const questionGenerationResult = await questionGeneration;
  if (questionGenerationResult.status === "rejected") {
    throw questionGenerationResult.error;
  }
  const questions = questionGenerationResult.value;
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
