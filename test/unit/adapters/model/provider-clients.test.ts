import { describe, expect, test } from "bun:test";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  RateLimitError
} from "@anthropic-ai/sdk";
import { ApiError, FinishReason } from "@google/genai";
import { z } from "zod";

import {
  AnthropicAdapterError,
  AnthropicStructuredClient,
  classifyAnthropicError,
  toAnthropicEffort,
  type AnthropicMessagesParser,
  type AnthropicParsedMessage
} from "../../../../src/adapters/anthropic/qa-client.ts";
import {
  classifyGoogleError,
  GoogleAdapterError,
  GoogleStructuredClient,
  type GoogleContentGenerator,
  type GoogleGeneratedContent
} from "../../../../src/adapters/google/qa-client.ts";
import { StructuredQaModel } from "../../../../src/adapters/model/structured-qa-model.ts";
import type { StructuredOutputRequest } from "../../../../src/adapters/model/structured-client.ts";
import {
  OpenAICompatibleAdapterError,
  OpenAICompatibleStructuredClient,
  readOpenAICompatibleBaseUrl,
  type ChatCompletionParser,
  type ChatCompletionResult
} from "../../../../src/adapters/openai/compatible-client.ts";

const schema = z.object({ answer: z.string() });

const request: StructuredOutputRequest<typeof schema> = {
  maxOutputTokens: 8_000,
  model: "test-model",
  prompt: { input: "入力", instructions: "指示" },
  reasoningEffort: "low",
  schema,
  schemaName: "test",
  timeoutMs: 60_000
};

class FakeAnthropicParser implements AnthropicMessagesParser {
  constructor(private readonly message: AnthropicParsedMessage<unknown>) {}

  async parse<Schema extends z.ZodType>(): Promise<
    AnthropicParsedMessage<z.output<Schema>>
  > {
    return this.message as AnthropicParsedMessage<z.output<Schema>>;
  }
}

class FakeGoogleGenerator implements GoogleContentGenerator {
  constructor(private readonly content: GoogleGeneratedContent) {}

  async generate(): Promise<GoogleGeneratedContent> {
    return this.content;
  }
}

class FakeChatParser implements ChatCompletionParser {
  constructor(
    private readonly result: ChatCompletionResult<unknown> | undefined
  ) {}

  async parse<Schema extends z.ZodType>(): Promise<
    ChatCompletionResult<z.output<Schema>> | undefined
  > {
    return this.result as ChatCompletionResult<z.output<Schema>> | undefined;
  }
}

describe("AnthropicStructuredClient", () => {
  test("正常終了ならparsed_outputを返す", async () => {
    const client = new AnthropicStructuredClient(
      new FakeAnthropicParser({
        parsed: { answer: "ok" },
        stopReason: "end_turn"
      })
    );
    expect(await client.parse(request)).toEqual({
      failed: false,
      incomplete: false,
      parsed: { answer: "ok" },
      refused: false
    });
  });

  test.each([
    ["refusal", { incomplete: false, refused: true }],
    ["max_tokens", { incomplete: true, refused: false }]
  ])("stop_reason %s では途中の出力を使わない", async (stopReason, flags) => {
    const client = new AnthropicStructuredClient(
      new FakeAnthropicParser({ parsed: { answer: "partial" }, stopReason })
    );
    expect(await client.parse(request)).toEqual({
      failed: false,
      parsed: null,
      ...flags
    });
  });

  test("受け付けない推論強度はlowに寄せる", () => {
    expect(toAnthropicEffort("none")).toBe("low");
    expect(toAnthropicEffort("minimal")).toBe("low");
    expect(toAnthropicEffort("high")).toBe("high");
  });

  test("SDKの例外をAnthropic名義で分類する", () => {
    expect(classifyAnthropicError(new APIUserAbortError())).toMatchObject({
      code: "aborted"
    });
    expect(
      classifyAnthropicError(new APIConnectionTimeoutError())
    ).toMatchObject({ code: "timeout", retryable: true });
    const rateLimit = new RateLimitError(
      429,
      undefined,
      "rate limited",
      new Headers()
    );
    const classified = classifyAnthropicError(rateLimit);
    expect(classified).toBeInstanceOf(AnthropicAdapterError);
    expect(classified).toMatchObject({ code: "rate_limit", retryable: true });
    expect(classified.message).toContain("Anthropic");
  });

  test("Q&Aの検証エラーもAnthropic名義で報告する", async () => {
    const model = new StructuredQaModel(
      new AnthropicStructuredClient(
        new FakeAnthropicParser({ parsed: null, stopReason: "refusal" })
      ),
      {
        maxOutputTokens: 8_000,
        model: "claude-opus-5-5",
        reasoningEffort: "low",
        strictness: "standard",
        timeoutMs: 60_000
      }
    );
    await expect(
      model.summarize({
        analysis: {
          summary: "s",
          filesChanged: 1,
          attention: [],
          findings: [],
          risks: []
        },
        exchanges: []
      })
    ).rejects.toMatchObject({
      code: "refusal",
      message: "Anthropic refused to produce the requested structured output."
    });
  });
});

describe("GoogleStructuredClient", () => {
  test("JSONを検証してから返す", async () => {
    const client = new GoogleStructuredClient(
      new FakeGoogleGenerator({
        blocked: false,
        finishReason: FinishReason.STOP,
        text: '{"answer":"ok"}'
      })
    );
    expect((await client.parse(request)).parsed).toEqual({ answer: "ok" });
  });

  test.each([
    [{ blocked: true, finishReason: undefined }, { refused: true }],
    [{ blocked: false, finishReason: FinishReason.SAFETY }, { refused: true }],
    [
      { blocked: false, finishReason: FinishReason.MAX_TOKENS },
      { incomplete: true }
    ]
  ])("拒否や打ち切りでは出力を使わない", async (content, flags) => {
    const client = new GoogleStructuredClient(
      new FakeGoogleGenerator({ ...content, text: '{"answer":"partial"}' })
    );
    expect(await client.parse(request)).toMatchObject({
      parsed: null,
      ...flags
    });
  });

  test.each(["not json", '{"other":1}'])(
    "スキーマに合わない出力は不正応答にする: %s",
    async (text) => {
      const client = new GoogleStructuredClient(
        new FakeGoogleGenerator({
          blocked: false,
          finishReason: FinishReason.STOP,
          text
        })
      );
      await expect(client.parse(request)).rejects.toMatchObject({
        code: "invalid_response"
      });
    }
  );

  test("ApiErrorをステータスで分類する", () => {
    const classified = classifyGoogleError(
      new ApiError({ message: "denied", status: 403 })
    );
    expect(classified).toBeInstanceOf(GoogleAdapterError);
    expect(classified).toMatchObject({ code: "permission" });
  });
});

describe("OpenAICompatibleStructuredClient", () => {
  test.each([
    [{ finishReason: "length", refusal: null }, { incomplete: true }],
    [{ finishReason: "stop", refusal: "no" }, { refused: true }],
    [{ finishReason: "content_filter", refusal: null }, { refused: true }]
  ])("打ち切りや拒否では出力を使わない", async (result, flags) => {
    const client = new OpenAICompatibleStructuredClient(
      new FakeChatParser({ ...result, parsed: { answer: "partial" } })
    );
    expect(await client.parse(request)).toMatchObject({
      parsed: null,
      ...flags
    });
  });

  test("choicesが空なら失敗として扱う", async () => {
    const client = new OpenAICompatibleStructuredClient(
      new FakeChatParser(undefined)
    );
    expect(await client.parse(request)).toMatchObject({ failed: true });
  });

  test("エラーは互換接続先の名義で報告する", () => {
    const client = new OpenAICompatibleStructuredClient(
      new FakeChatParser(undefined)
    );
    const error = client.classifyError(new Error("boom"));
    expect(error).toBeInstanceOf(OpenAICompatibleAdapterError);
    expect(error.message).toBe(
      "The OpenAI-compatible endpoint request failed."
    );
  });
});

describe("readOpenAICompatibleBaseUrl", () => {
  test("http(s)のURLだけを受け付ける", () => {
    expect(
      readOpenAICompatibleBaseUrl({
        SEKISYO_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1"
      })
    ).toBe("http://localhost:11434/v1");
  });

  test.each([
    [{}, "SEKISYO_OPENAI_COMPATIBLE_BASE_URL"],
    [{ SEKISYO_OPENAI_COMPATIBLE_BASE_URL: "file:///etc/passwd" }, "http"],
    [{ SEKISYO_OPENAI_COMPATIBLE_BASE_URL: "not a url" }, "URL"],
    [
      {
        SEKISYO_OPENAI_COMPATIBLE_BASE_URL: "https://user:pass@example.com/v1"
      },
      "資格情報"
    ]
  ])("不正な接続先は拒否する", (environment, message) => {
    expect(() => readOpenAICompatibleBaseUrl(environment)).toThrow(message);
  });
});
