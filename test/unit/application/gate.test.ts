import { describe, expect, test } from "bun:test";
import {
  ensureSessionSummary,
  runGate,
  type GateDependencies,
  type GateTarget
} from "../../../src/application/gate.ts";
import {
  DEFAULT_CONFIG,
  createPolicyDigest
} from "../../../src/config/index.ts";
import type { DiffAnalysis } from "../../../src/domain/analysis.ts";
import { fingerprint as digestText } from "../../../src/domain/fingerprint.ts";
import type {
  AnswerJudgment,
  QaSummary,
  Question
} from "../../../src/domain/questions.ts";
import type { SessionRecord } from "../../../src/domain/session.ts";
import type {
  DiffAnalyzer,
  QaModel,
  SessionStore,
  Terminal
} from "../../../src/ports/index.ts";

const analysis: DiffAnalysis = {
  attention: [
    {
      classification: "must_read",
      path: "src/cache.ts",
      reason: "競合時の振る舞いが変わる",
      startLine: 10,
      endLine: 20
    }
  ],
  filesChanged: 1,
  findings: [
    {
      explanation: "古い値が戻る可能性がある",
      id: "finding-1",
      line: 15,
      path: "src/cache.ts",
      severity: "warning",
      title: "キャッシュ更新が競合する"
    }
  ],
  risks: ["同時更新"],
  summary: "キャッシュ無効化を変更"
};

const initialQuestion: Question = {
  category: "boundary",
  evidence: ["src/cache.ts:10"],
  id: "q-1",
  learningObjective: "境界条件を説明できる",
  prompt: "空のキャッシュではどう動きますか?",
  rubric: ["空の場合の分岐を説明する"]
};

const FOLLOW_UP_PROMPT = "空の場合に通る分岐を行番号つきで説明してください";
const VALID_REVIEW_REASON = "呼び出し側で直列化し、競合リスクを回避します";

const summary: QaSummary = {
  decisions: ["明示的に無効化する"],
  intent: "競合を避ける",
  risks: ["同時更新"],
  unresolved: [],
  verification: ["競合テスト"]
};

class MemorySessionStore implements SessionStore {
  readonly records = new Map<string, SessionRecord>();

  async load(fingerprint: string): Promise<SessionRecord | null> {
    return this.records.get(fingerprint) ?? null;
  }

  async list(): Promise<readonly SessionRecord[]> {
    return [...this.records.values()];
  }

  async save(session: SessionRecord): Promise<void> {
    this.records.set(session.fingerprint, session);
  }

  async remove(fingerprint: string): Promise<void> {
    this.records.delete(fingerprint);
  }
}

class ScriptedTerminal implements Terminal {
  readonly messages: string[] = [];

  public constructor(
    private readonly answers: string[],
    private readonly selections: string[]
  ) {}

  write(message: string): void {
    this.messages.push(message);
  }

  error(message: string): void {
    this.messages.push(message);
  }

  async prompt(): Promise<string> {
    return this.answers.shift() ?? "";
  }

  async confirm(): Promise<boolean> {
    return true;
  }

  async select<Value extends string>(): Promise<Value> {
    const value = this.selections.shift();
    if (value === undefined) {
      throw new Error("No scripted selection remains.");
    }
    return value as Value;
  }
}

class StaticAnalyzer implements DiffAnalyzer {
  calls = 0;

  async analyze(): Promise<DiffAnalysis> {
    this.calls += 1;
    return analysis;
  }
}

class ScriptedModel implements QaModel {
  generateQuestionCalls = 0;
  readonly judgedQuestionIds: string[] = [];
  readonly judgments: AnswerJudgment[] = [
    {
      feedback: "分岐の根拠が不足しています",
      followUp: FOLLOW_UP_PROMPT,
      missingConcept: "空入力の分岐",
      passed: false
    },
    {
      feedback: "具体的に説明できています",
      passed: true
    }
  ];
  summarizeCalls = 0;

  async generateQuestions(): Promise<readonly Question[]> {
    this.generateQuestionCalls += 1;
    return [initialQuestion];
  }

  async judgeAnswer(
    input: Parameters<QaModel["judgeAnswer"]>[0]
  ): Promise<AnswerJudgment> {
    this.judgedQuestionIds.push(input.question.id);
    const judgment = this.judgments.shift();
    if (judgment === undefined) {
      throw new Error("No scripted judgment remains.");
    }
    return judgment;
  }

  async summarize(): Promise<QaSummary> {
    this.summarizeCalls += 1;
    return summary;
  }
}

class ExhaustingModel implements QaModel {
  judgmentCalls = 0;

  async generateQuestions(): Promise<readonly Question[]> {
    return [initialQuestion];
  }

  async judgeAnswer(): Promise<AnswerJudgment> {
    this.judgmentCalls += 1;
    return {
      feedback: "まだ具体的な根拠が不足しています",
      followUp: FOLLOW_UP_PROMPT,
      missingConcept: "実装上の分岐",
      passed: false
    };
  }

  async summarize(): Promise<QaSummary> {
    throw new Error("失敗した試問を要約してはいけません");
  }
}

function target(): GateTarget {
  const diff = [
    "diff --git a/src/cache.ts b/src/cache.ts",
    "--- a/src/cache.ts",
    "+++ b/src/cache.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new"
  ].join("\n");
  return {
    analysisTarget: { baseRef: "a".repeat(40), kind: "base" },
    base: "a".repeat(40),
    changedFiles: ["src/cache.ts"],
    diff,
    diffDigest: digestText(diff),
    head: "b".repeat(40),
    policyDigest: createPolicyDigest(DEFAULT_CONFIG),
    ref: `refs/heads/feature@${"c".repeat(40)}`,
    remote: "origin",
    repoRoot: "/repo"
  };
}

describe("runGate", () => {
  test("session digestとanalyzerへ同じ固定diffを渡す", async () => {
    const gateTarget = { ...target() };
    const originalDiff = gateTarget.diff;
    const mutatedDiff = `${originalDiff}\n+mutated`;
    let analyzedDiff: string | undefined;
    const records = new Map<string, SessionRecord>();
    const store: SessionStore = {
      async list() {
        return [...records.values()];
      },
      async load() {
        return null;
      },
      async remove(fingerprint) {
        records.delete(fingerprint);
      },
      async save(session) {
        records.set(session.fingerprint, session);
        gateTarget.diff = mutatedDiff;
      }
    };
    const analyzer: DiffAnalyzer = {
      async analyze(input) {
        analyzedDiff = input.diff;
        throw new Error("stop after analysis input");
      }
    };

    await expect(
      runGate(
        {
          analyzer,
          model: new ScriptedModel(),
          store,
          terminal: new ScriptedTerminal([], [])
        },
        DEFAULT_CONFIG,
        gateTarget
      )
    ).rejects.toThrow("stop after analysis input");

    expect(gateTarget.diff).toBe(mutatedDiff);
    expect(analyzedDiff).toBe(originalDiff);
    expect([...records.values()][0]?.diffDigest).toBe(digestText(originalDiff));
  });

  test("定型的な指摘理由を再入力させ、追撃後にpassedで終了する", async () => {
    const store = new MemorySessionStore();
    const terminal = new ScriptedTerminal(
      [
        "問題ないです",
        VALID_REVIEW_REASON,
        "空でも大丈夫です",
        "src/cache.ts:12のempty分岐で何も書き戻しません"
      ],
      ["intentional"]
    );
    const model = new ScriptedModel();
    const session = await runGate(
      {
        analyzer: new StaticAnalyzer(),
        clock: () => "2026-07-18T12:00:00.000Z",
        model,
        store,
        terminal
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );

    expect(session.status).toBe("passed");
    expect(session.reviewResolutions).toHaveLength(1);
    expect(session.reviewResolutions[0]?.reason).toBe(VALID_REVIEW_REASON);
    expect(session.attempts.map((attempt) => attempt.passed)).toEqual([
      false,
      true
    ]);
    expect(session.questions).toEqual([
      initialQuestion,
      {
        ...initialQuestion,
        id: "follow-up-1",
        prompt: FOLLOW_UP_PROMPT
      }
    ]);
    expect(session.questions.map((question) => question.category)).toEqual([
      "boundary",
      "boundary"
    ]);
    expect(model.generateQuestionCalls).toBe(1);
    expect(model.judgedQuestionIds).toEqual(["q-1", "follow-up-1"]);
    expect(session.summary).toBeNull();
    expect(model.summarizeCalls).toBe(0);
    expect(
      terminal.messages.some((message) =>
        message.includes("定型的な回答では記録できません")
      )
    ).toBe(true);
  });

  test("同じHEAD・policy・diffの通過記録は非対話hookでも再利用する", async () => {
    const store = new MemorySessionStore();
    const firstAnalyzer = new StaticAnalyzer();
    const first = await runGate(
      {
        analyzer: firstAnalyzer,
        clock: () => "2026-07-18T12:00:00.000Z",
        model: new ScriptedModel(),
        store,
        terminal: new ScriptedTerminal(
          [VALID_REVIEW_REASON, "曖昧", "具体的な根拠"],
          ["intentional"]
        )
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );
    const analyzer: DiffAnalyzer = {
      async analyze() {
        throw new Error("再分析してはいけません");
      }
    };
    const model: QaModel = {
      async generateQuestions() {
        throw new Error("再生成してはいけません");
      },
      async judgeAnswer() {
        throw new Error("再判定してはいけません");
      },
      async summarize() {
        throw new Error("再要約してはいけません");
      }
    };
    const dependencies: GateDependencies = { analyzer, model, store };

    const reused = await runGate(
      dependencies,
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );

    expect(reused.fingerprint).toBe(first.fingerprint);
    expect(reused.status).toBe("passed");
    expect(firstAnalyzer.calls).toBe(1);
  });

  test("passed記録はPR用の明示的な要約処理でのみsummarizedへ進む", async () => {
    const store = new MemorySessionStore();
    const firstModel = new ScriptedModel();
    const passed = await runGate(
      {
        analyzer: new StaticAnalyzer(),
        clock: () => "2026-07-18T12:00:00.000Z",
        model: firstModel,
        store,
        terminal: new ScriptedTerminal(
          [VALID_REVIEW_REASON, "曖昧", "具体的な根拠"],
          ["intentional"]
        )
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );

    expect(passed.status).toBe("passed");
    expect(firstModel.summarizeCalls).toBe(0);
    firstModel.summarize = async () => {
      throw new Error("summary unavailable");
    };

    await expect(
      ensureSessionSummary(
        {
          clock: () => "2026-07-18T12:00:00.000Z",
          model: firstModel,
          store
        },
        passed
      )
    ).rejects.toThrow("summary unavailable");
    expect([...store.records.values()][0]?.status).toBe("passed");

    let summarizeCalls = 0;
    const recoveryModel: QaModel = {
      async generateQuestions() {
        throw new Error("質問を再生成してはいけません");
      },
      async judgeAnswer() {
        throw new Error("回答を再判定してはいけません");
      },
      async summarize() {
        summarizeCalls += 1;
        return summary;
      }
    };

    const recovered = await ensureSessionSummary(
      {
        model: recoveryModel,
        store
      },
      passed
    );

    expect(recovered.status).toBe("summarized");
    expect(recovered.summary).toEqual(summary);
    expect(summarizeCalls).toBe(1);
  });

  test("同じbindingでもdiffが変われば通過記録を再利用しない", async () => {
    const store = new MemorySessionStore();
    const first = await runGate(
      {
        analyzer: new StaticAnalyzer(),
        clock: () => "2026-07-18T12:00:00.000Z",
        model: new ScriptedModel(),
        store,
        terminal: new ScriptedTerminal(
          [VALID_REVIEW_REASON, "曖昧", "具体的な根拠"],
          ["intentional"]
        )
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );
    const analyzer = new StaticAnalyzer();
    const changedDiff = `${target().diff}\n# changed`;
    const changedTarget = {
      ...target(),
      diff: changedDiff,
      diffDigest: digestText(changedDiff)
    };

    const second = await runGate(
      {
        analyzer,
        clock: () => "2026-07-18T12:00:01.000Z",
        model: new ScriptedModel(),
        store,
        terminal: new ScriptedTerminal(
          ["上限10件、超過時は400で拒否します", "曖昧", "具体的な根拠"],
          ["intentional"]
        )
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      changedTarget
    );

    expect(analyzer.calls).toBe(1);
    expect(second.diffDigest).not.toBe(first.diffDigest);
  });

  test("追撃上限に達したら追加生成せずfailedとして保存する", async () => {
    const store = new MemorySessionStore();
    const model = new ExhaustingModel();

    await expect(
      runGate(
        {
          analyzer: new StaticAnalyzer(),
          clock: () => "2026-07-18T12:00:00.000Z",
          model,
          store,
          terminal: new ScriptedTerminal(
            [VALID_REVIEW_REASON, "回答1", "回答2"],
            ["intentional"]
          )
        },
        {
          ...DEFAULT_CONFIG,
          questions: {
            ...DEFAULT_CONFIG.questions,
            count: 1,
            maxFollowUps: 1
          }
        },
        target()
      )
    ).rejects.toMatchObject({ code: "follow_ups_exhausted" });

    const failed = [...store.records.values()][0];
    expect(failed?.status).toBe("failed");
    expect(failed?.attempts).toHaveLength(2);
    expect(failed?.questions).toHaveLength(2);
    expect(model.judgmentCalls).toBe(2);
  });

  test("privacy対象パスは外部分析やセッション保存より前に拒否する", async () => {
    const store = new MemorySessionStore();
    const analyzer: DiffAnalyzer = {
      async analyze() {
        throw new Error("privacy対象の差分を分析してはいけません");
      }
    };

    await expect(
      runGate(
        {
          analyzer,
          model: new ScriptedModel(),
          store
        },
        DEFAULT_CONFIG,
        {
          ...target(),
          changedFiles: ["src/secrets/token.txt"]
        }
      )
    ).rejects.toMatchObject({ code: "privacy_exclusion" });
    expect(store.records.size).toBe(0);
  });

  test("一次レビューで修正を選ぶと試問へ進まず中断する", async () => {
    const store = new MemorySessionStore();
    const model = new ScriptedModel();

    await expect(
      runGate(
        {
          analyzer: new StaticAnalyzer(),
          clock: () => "2026-07-18T12:00:00.000Z",
          model,
          store,
          terminal: new ScriptedTerminal([], ["fix"])
        },
        {
          ...DEFAULT_CONFIG,
          questions: { ...DEFAULT_CONFIG.questions, count: 1 }
        },
        target()
      )
    ).rejects.toMatchObject({ code: "fix_requested" });
    expect(model.judgments).toHaveLength(2);
    expect([...store.records.values()][0]?.status).toBe("analyzed");
  });

  test("一次レビュー中に質問生成を開始し、修正選択時にabortする", async () => {
    const store = new MemorySessionStore();
    let generationStarted = false;
    let generationAborted = false;
    const model: QaModel = {
      generateQuestions(_input, signal) {
        generationStarted = true;
        return new Promise<readonly Question[]>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              generationAborted = true;
              reject(new Error("question generation aborted"));
            },
            { once: true }
          );
        });
      },
      async judgeAnswer() {
        throw new Error("回答判定へ進んではいけません");
      },
      async summarize() {
        throw new Error("要約へ進んではいけません");
      }
    };
    const terminal: Terminal = {
      async confirm() {
        return true;
      },
      error() {},
      async prompt() {
        return "";
      },
      async select<Value extends string>(): Promise<Value> {
        expect(generationStarted).toBe(true);
        return "fix" as Value;
      },
      write() {}
    };

    await expect(
      runGate(
        {
          analyzer: new StaticAnalyzer(),
          model,
          store,
          terminal
        },
        {
          ...DEFAULT_CONFIG,
          questions: { ...DEFAULT_CONFIG.questions, count: 1 }
        },
        target()
      )
    ).rejects.toMatchObject({ code: "fix_requested" });

    expect(generationAborted).toBe(true);
    expect([...store.records.values()][0]?.status).toBe("analyzed");
  });

  test("質問生成がAbortSignalを無視しても修正選択を即時返却する", async () => {
    const store = new MemorySessionStore();
    let rejectGeneration: ((reason?: unknown) => void) | undefined;
    const model: QaModel = {
      generateQuestions() {
        return new Promise<readonly Question[]>((_resolve, reject) => {
          rejectGeneration = reject;
        });
      },
      async judgeAnswer() {
        throw new Error("回答判定へ進んではいけません");
      },
      async summarize() {
        throw new Error("要約へ進んではいけません");
      }
    };
    const gatePromise = runGate(
      {
        analyzer: new StaticAnalyzer(),
        model,
        store,
        terminal: new ScriptedTerminal([], ["fix"])
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target()
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("fix_requested timed out")),
        250
      );
    });

    try {
      await expect(
        Promise.race([gatePromise, timeoutPromise])
      ).rejects.toMatchObject({ code: "fix_requested" });
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      rejectGeneration?.(new Error("delayed question generation failure"));
    }

    expect(rejectGeneration).toBeDefined();
    expect([...store.records.values()][0]?.status).toBe("analyzed");
  });

  test("再利用しない指定では既存sessionを読み込まない", async () => {
    const records = new Map<string, SessionRecord>();
    const store: SessionStore = {
      async list() {
        return [...records.values()];
      },
      async load() {
        throw new Error("sessionを読み込んではいけません");
      },
      async remove(fingerprint) {
        records.delete(fingerprint);
      },
      async save(session) {
        records.set(session.fingerprint, session);
      }
    };

    const session = await runGate(
      {
        analyzer: new StaticAnalyzer(),
        model: new ScriptedModel(),
        store,
        terminal: new ScriptedTerminal(
          [VALID_REVIEW_REASON, "曖昧", "具体的な根拠"],
          ["intentional"]
        )
      },
      {
        ...DEFAULT_CONFIG,
        questions: { ...DEFAULT_CONFIG.questions, count: 1 }
      },
      target(),
      { allowReuse: false }
    );

    expect(session.status).toBe("passed");
  });
});
