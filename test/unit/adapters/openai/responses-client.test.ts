import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import type { ParsedResponse } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  OpenAISdkResponsesClient,
  type StructuredResponseRequest
} from "../../../../src/adapters/openai/responses-client.ts";

type SdkResponse = ParsedResponse<unknown>;
type SdkOutputItem = SdkResponse["output"][number];

// 実装が読むのはこの4項目だけ。SDK の型から取るので、項目名や値の型が
// 変わればここで typecheck が落ちる
type ReadFields = Pick<
  SdkResponse,
  "error" | "output" | "output_parsed" | "status"
>;

interface ParseCall {
  readonly body: unknown;
  readonly options: unknown;
}

const schema = z.object({ answer: z.string() });

const request: StructuredResponseRequest<typeof schema> = {
  maxOutputTokens: 8_000,
  model: "test-model",
  prompt: { input: "入力", instructions: "指示" },
  reasoningEffort: "low",
  schema,
  schemaName: "test_schema",
  timeoutMs: 60_000
};

function sdkResponse(fields: Partial<ReadFields> = {}): SdkResponse {
  const base: ReadFields = {
    error: null,
    output: [],
    output_parsed: null,
    status: "completed"
  };
  // 実装が読まない必須項目（id や model など）は省く
  return { ...base, ...fields } as SdkResponse;
}

function messageItem(
  content: Extract<SdkOutputItem, { type: "message" }>["content"]
): SdkOutputItem {
  return {
    content,
    id: "msg_test",
    role: "assistant",
    status: "completed",
    type: "message"
  };
}

function createClient(response: SdkResponse): {
  readonly calls: ParseCall[];
  readonly client: OpenAISdkResponsesClient;
} {
  // 通信は responses.parse の差し替えで止めるので、キーはダミーでよい
  const sdk = new OpenAI({ apiKey: "sk-test-dummy" });
  const calls: ParseCall[] = [];
  sdk.responses.parse = (async (body: unknown, options: unknown) => {
    calls.push({ body, options });
    return response;
  }) as typeof sdk.responses.parse;
  return { calls, client: new OpenAISdkResponsesClient(sdk) };
}

describe("OpenAISdkResponsesClient のリクエスト組み立て", () => {
  test("parse に渡すパラメータと store: false を固定する", async () => {
    const { calls, client } = createClient(sdkResponse());
    const controller = new AbortController();

    await client.parse(request, controller.signal);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.body).toMatchObject({
      input: "入力",
      instructions: "指示",
      max_output_tokens: 8_000,
      model: "test-model",
      reasoning: { effort: "low" },
      store: false,
      text: { format: { name: "test_schema", type: "json_schema" } }
    });
    expect(call?.options).toEqual({
      signal: controller.signal,
      timeout: 60_000
    });
  });
});

describe("OpenAISdkResponsesClient のレスポンス変換", () => {
  test("output_parsed を parsed に、status をそのまま返す", async () => {
    const { client } = createClient(
      sdkResponse({ output_parsed: { answer: "回答" }, status: "completed" })
    );

    const result = await client.parse(request);

    expect(result).toEqual({
      failed: false,
      parsed: { answer: "回答" },
      refused: false,
      status: "completed"
    });
  });

  test("output_parsed が null なら parsed も null", async () => {
    const { client } = createClient(sdkResponse({ status: "incomplete" }));

    const result = await client.parse(request);

    expect(result.parsed).toBeNull();
    expect(result.status).toBe("incomplete");
  });

  test("error があれば status が completed でも failed", async () => {
    const { client } = createClient(
      sdkResponse({
        error: { code: "server_error", message: "boom" },
        status: "completed"
      })
    );

    const result = await client.parse(request);

    expect(result.failed).toBe(true);
  });

  test("status が failed なら error が null でも failed", async () => {
    const { client } = createClient(
      sdkResponse({ error: null, status: "failed" })
    );

    const result = await client.parse(request);

    expect(result.failed).toBe(true);
    expect(result.status).toBe("failed");
  });

  test("message の content に refusal があれば refused", async () => {
    const { client } = createClient(
      sdkResponse({
        output: [
          messageItem([{ refusal: "お答えできません", type: "refusal" }])
        ]
      })
    );

    const result = await client.parse(request);

    expect(result.refused).toBe(true);
  });

  test("message に refusal が無ければ refused ではない", async () => {
    const { client } = createClient(
      sdkResponse({
        output: [
          messageItem([
            {
              annotations: [],
              parsed: { answer: "回答" },
              text: '{"answer":"回答"}',
              type: "output_text"
            }
          ])
        ],
        output_parsed: { answer: "回答" }
      })
    );

    const result = await client.parse(request);

    expect(result.refused).toBe(false);
  });

  test("message 以外の出力項目は refusal 判定の対象にしない", async () => {
    const { client } = createClient(
      sdkResponse({
        output: [{ id: "rs_test", summary: [], type: "reasoning" }]
      })
    );

    const result = await client.parse(request);

    expect(result.refused).toBe(false);
  });
});
