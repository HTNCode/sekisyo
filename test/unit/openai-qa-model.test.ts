import { describe, expect, test } from "bun:test";
import { APIError, RateLimitError } from "openai";
import type { ResponseStatus } from "openai/resources/responses/responses";
import type { z } from "zod";

import {
  classifyOpenAIError,
  DEFAULT_OPENAI_MODEL,
  OpenAIAdapterError,
  OpenAIQaModel
} from "../../src/adapters/openai/index.ts";
import type {
  OpenAIResponsesClient,
  StructuredResponse,
  StructuredResponseRequest
} from "../../src/adapters/openai/responses-client.ts";

interface FakeResponseOptions {
  readonly candidateFactory?: () => unknown;
  readonly failed?: boolean;
  readonly refused?: boolean;
  readonly status?: ResponseStatus;
}

class FakeResponsesClient implements OpenAIResponsesClient {
  readonly prompts: Array<{
    readonly input: string;
    readonly instructions: string;
  }> = [];
  readonly requests: Array<{
    readonly model: string;
    readonly schemaName: string;
    readonly timeoutMs: number;
  }> = [];
  readonly #nextCandidate: () => unknown;
  readonly #options: FakeResponseOptions;

  constructor(candidate: unknown, options: FakeResponseOptions = {}) {
    this.#nextCandidate = options.candidateFactory ?? (() => candidate);
    this.#options = options;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredResponseRequest<Schema>
  ): Promise<StructuredResponse<z.output<Schema>>> {
    const candidate = this.#nextCandidate();
    this.prompts.push({
      input: request.prompt.input,
      instructions: request.prompt.instructions
    });
    this.requests.push({
      model: request.model,
      schemaName: request.schemaName,
      timeoutMs: request.timeoutMs
    });
    return {
      failed: this.#options.failed ?? false,
      incompleteReason: null,
      parsed: candidate === null ? null : request.schema.parse(candidate),
      refused: this.#options.refused ?? false,
      status: this.#options.status
    };
  }
}

const analysis = {
  summary: "認証境界を変更した",
  filesChanged: 1,
  attention: [],
  findings: [],
  risks: ["認証失敗時の動作"]
};

const question = {
  id: "q1",
  category: "boundary" as const,
  prompt: "認証失敗時の境界を説明してください",
  learningObjective: "境界条件を説明できる",
  evidence: ["src/auth.ts"],
  rubric: ["失敗時の挙動を説明する"]
};

const customQuestion = {
  ...question,
  id: "q-custom",
  category: "custom" as const,
  prompt: "プロジェクト固有の運用条件を説明してください"
};

describe("OpenAIQaModel", () => {
  test("既定モデルと明示timeoutで質問を生成する", async () => {
    const client = new FakeResponsesClient({ questions: [question] });
    const model = new OpenAIQaModel(client);

    const result = await model.generateQuestions({
      analysis,
      questionCount: 1,
      categories: [{ name: "boundary", required: true }]
    });

    expect(result).toEqual([question]);
    expect(client.requests).toEqual([
      {
        model: DEFAULT_OPENAI_MODEL,
        schemaName: "sekisyo_questions",
        timeoutMs: 60_000
      }
    ]);
  });

  test.each([
    [{ status: "incomplete" as const }, "incomplete"],
    [{ refused: true }, "refusal"]
  ])("異常応答を分類する", async (options, expectedCode) => {
    const model = new OpenAIQaModel(
      new FakeResponsesClient({ questions: [question] }, options)
    );

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: []
      })
    ).rejects.toMatchObject({ code: expectedCode });
  });

  test("parsed欠落を分類する", async () => {
    const model = new OpenAIQaModel(new FakeResponsesClient(null));

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: []
      })
    ).rejects.toBeInstanceOf(OpenAIAdapterError);
    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: []
      })
    ).rejects.toMatchObject({ code: "missing_parsed_output" });
  });

  test("必須カテゴリが欠けたモデル応答を拒否する", async () => {
    const model = new OpenAIQaModel(
      new FakeResponsesClient({ questions: [question] })
    );

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: [{ name: "failure", required: true }]
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("必須カテゴリ数が質問数を超える入力はAPI呼び出し前に拒否する", async () => {
    const client = new FakeResponsesClient({ questions: [question] });
    const model = new OpenAIQaModel(client);

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: [
          { name: "boundary", required: true },
          { name: "failure", required: true }
        ]
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.requests).toHaveLength(0);
  });

  test("複数の必須カスタムカテゴリに必要な質問数が欠けた応答を拒否する", async () => {
    const model = new OpenAIQaModel(
      new FakeResponsesClient({
        questions: [question, customQuestion]
      })
    );

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 2,
        categories: [
          { name: "boundary", required: false },
          { name: "security-policy", required: true },
          { name: "accessibility-policy", required: true }
        ]
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("無効化された組み込みカテゴリの質問を拒否する", async () => {
    const model = new OpenAIQaModel(
      new FakeResponsesClient({ questions: [question] })
    );

    await expect(
      model.generateQuestions({
        analysis,
        questionCount: 1,
        categories: [{ name: "failure", required: false }]
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("不合格判定と同じ応答で不足概念と追撃質問を返す", async () => {
    const client = new FakeResponsesClient({
      passed: false,
      feedback: "具体的な境界条件が不足しています",
      missingConcept: "認証失敗時の分岐",
      followUp: "認証失敗時に通る分岐と返却値を説明してください"
    });
    const model = new OpenAIQaModel(client);

    const result = await model.judgeAnswer({
      answer: "失敗時も処理します",
      question
    });

    expect(result).toEqual({
      passed: false,
      feedback: "具体的な境界条件が不足しています",
      missingConcept: "認証失敗時の分岐",
      followUp: "認証失敗時に通る分岐と返却値を説明してください"
    });
    expect(client.requests[0]?.schemaName).toBe("sekisyo_answer_judgment");
    expect(client.requests).toHaveLength(1);
  });

  test("既定のレビュー強度standardで回答を判定する", async () => {
    const client = new FakeResponsesClient({
      passed: true,
      feedback: "具体的に説明できています",
      missingConcept: null,
      followUp: null
    });
    const model = new OpenAIQaModel(client);

    await model.judgeAnswer({ answer: "401分岐で処理を止めます", question });

    expect(client.prompts[0]?.instructions).toContain(
      "レビュー強度はstandardです"
    );
  });

  test.each([
    ["light", "境界条件やトレードオフの網羅は要求せず"],
    ["strict", "境界条件とトレードオフの両方"]
  ] as const)(
    "レビュー強度%sの合格基準で回答を判定する",
    async (strictness, expectedCriteria) => {
      const client = new FakeResponsesClient({
        passed: true,
        feedback: "具体的に説明できています",
        missingConcept: null,
        followUp: null
      });
      const model = new OpenAIQaModel(client, { strictness });

      await model.judgeAnswer({ answer: "401分岐で処理を止めます", question });

      expect(client.prompts[0]?.instructions).toContain(
        `レビュー強度は${strictness}です`
      );
      expect(client.prompts[0]?.instructions).toContain(expectedCriteria);
    }
  );

  test("合格判定では不足概念と追撃質問を返さない", async () => {
    const model = new OpenAIQaModel(
      new FakeResponsesClient({
        passed: true,
        feedback: "具体的に説明できています",
        missingConcept: null,
        followUp: null
      })
    );

    await expect(
      model.judgeAnswer({
        answer: "401分岐で処理を止め、呼び出し元へエラーを返します",
        question
      })
    ).resolves.toEqual({
      passed: true,
      feedback: "具体的に説明できています"
    });
  });

  test.each([
    {
      passed: false,
      feedback: "不足しています",
      missingConcept: null,
      followUp: "分岐を説明してください"
    },
    {
      passed: false,
      feedback: "不足しています",
      missingConcept: "失敗時の分岐",
      followUp: null
    },
    {
      passed: true,
      feedback: "十分です",
      missingConcept: "不要な不足概念",
      followUp: null
    },
    {
      passed: true,
      feedback: "十分です",
      missingConcept: null,
      followUp: "不要な追撃"
    }
  ])("判定と追撃情報が矛盾する応答を拒否する", async (candidate) => {
    const client = new FakeResponsesClient(candidate);
    const model = new OpenAIQaModel(client);

    await expect(
      model.judgeAnswer({
        answer: "回答",
        question
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(client.requests).toHaveLength(2);
  });

  test("相関違反だけを同じ入力で一度再判定する", async () => {
    const candidates = [
      {
        passed: false,
        feedback: "不足しています",
        missingConcept: null,
        followUp: "分岐を説明してください"
      },
      {
        passed: false,
        feedback: "境界条件が不足しています",
        missingConcept: "認証失敗時の分岐",
        followUp: "認証失敗時に通る分岐を説明してください"
      }
    ];
    const client = new FakeResponsesClient(null, {
      candidateFactory: () => candidates.shift()
    });
    const model = new OpenAIQaModel(client);

    await expect(
      model.judgeAnswer({
        answer: "失敗時も処理します",
        question
      })
    ).resolves.toEqual({
      passed: false,
      feedback: "境界条件が不足しています",
      missingConcept: "認証失敗時の分岐",
      followUp: "認証失敗時に通る分岐を説明してください"
    });
    expect(client.requests).toHaveLength(2);
    expect(client.prompts[1]).toEqual(client.prompts[0]);
  });

  test("形状不正な判定応答は意味的な再判定の対象にしない", async () => {
    const client = new FakeResponsesClient({
      passed: false,
      feedback: "不足しています"
    });
    const model = new OpenAIQaModel(client);

    await expect(
      model.judgeAnswer({
        answer: "回答",
        question
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(client.requests).toHaveLength(1);
  });

  test.each([
    {
      passed: false,
      feedback: "不足しています",
      missingConcept: "   ",
      followUp: "分岐を説明してください"
    },
    {
      passed: false,
      feedback: "不足しています",
      missingConcept: "失敗時の分岐",
      followUp: "   "
    }
  ])("空白だけの追撃情報を拒否する", async (candidate) => {
    const client = new FakeResponsesClient(candidate);
    const model = new OpenAIQaModel(client);

    await expect(
      model.judgeAnswer({
        answer: "回答",
        question
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(client.requests).toHaveLength(1);
  });
});

describe("classifyOpenAIError", () => {
  test("429のquotaとrate limitを分離する", () => {
    const headers = new Headers();
    const quota = new RateLimitError(
      429,
      { code: "insufficient_quota" },
      "quota",
      headers
    );
    const rateLimit = new RateLimitError(
      429,
      { code: "rate_limit_exceeded" },
      "rate",
      headers
    );

    expect(classifyOpenAIError(quota)).toMatchObject({
      code: "quota_exhausted",
      retryable: false
    });
    expect(classifyOpenAIError(rateLimit)).toMatchObject({
      code: "rate_limit",
      retryable: true
    });
  });

  test("5xxのみ再試行可能なserver errorにする", () => {
    const error = new APIError(503, {}, "server", new Headers());
    expect(classifyOpenAIError(error)).toMatchObject({
      code: "server",
      retryable: true
    });
  });
});
