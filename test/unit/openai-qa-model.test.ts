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
  readonly failed?: boolean;
  readonly refused?: boolean;
  readonly status?: ResponseStatus;
}

class FakeResponsesClient implements OpenAIResponsesClient {
  readonly requests: Array<{
    readonly model: string;
    readonly schemaName: string;
    readonly timeoutMs: number;
  }> = [];
  readonly #candidate: unknown;
  readonly #options: FakeResponseOptions;

  constructor(candidate: unknown, options: FakeResponseOptions = {}) {
    this.#candidate = candidate;
    this.#options = options;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredResponseRequest<Schema>
  ): Promise<StructuredResponse<z.output<Schema>>> {
    this.requests.push({
      model: request.model,
      schemaName: request.schemaName,
      timeoutMs: request.timeoutMs
    });
    return {
      failed: this.#options.failed ?? false,
      incompleteReason: null,
      parsed:
        this.#candidate === null ? null : request.schema.parse(this.#candidate),
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
