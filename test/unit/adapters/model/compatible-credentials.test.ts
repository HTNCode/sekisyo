import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { createOpenAICompatibleStructuredClient } from "../../../../src/adapters/openai/compatible-client.ts";

const MARKERS = {
  OPENAI_ADMIN_KEY: "marker-admin-key",
  OPENAI_API_KEY: "marker-openai-key",
  OPENAI_ORG_ID: "marker-org-id",
  OPENAI_PROJECT_ID: "marker-project-id"
} as const;

const restoreEnvironment: (() => void)[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

function setEnvironment(name: string, value: string): void {
  const previous = process.env[name];
  restoreEnvironment.push(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
  process.env[name] = value;
}

afterEach(async () => {
  for (const restore of restoreEnvironment.splice(0)) {
    restore();
  }
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

/** 受け取ったヘッダを記録し、構造化出力として妥当な応答を返す互換サーバー。 */
function startRecordingServer(): {
  readonly baseUrl: string;
  readonly headers: Headers[];
} {
  const headers: Headers[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      headers.push(request.headers);
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "local-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            logprobs: null,
            message: {
              role: "assistant",
              content: '{"answer":"ok"}',
              refusal: null
            }
          }
        ]
      });
    }
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, headers };
}

async function callOnce(
  environment: Readonly<Record<string, string>>
): Promise<void> {
  const client = createOpenAICompatibleStructuredClient({
    environment,
    maxRetries: 0,
    timeoutMs: 10_000
  });
  const result = await client.parse({
    maxOutputTokens: 100,
    model: "local-model",
    prompt: { input: "入力", instructions: "指示" },
    reasoningEffort: "low",
    schema: z.object({ answer: z.string() }),
    schemaName: "test",
    timeoutMs: 10_000
  });
  expect(result.parsed).toEqual({ answer: "ok" });
}

describe("OpenAI互換の接続先へ送る資格情報", () => {
  test("OpenAIのキー・組織・プロジェクト・管理キーを送らない", async () => {
    for (const [name, value] of Object.entries(MARKERS)) {
      setEnvironment(name, value);
    }
    const server = startRecordingServer();

    await callOnce({ SEKISYO_OPENAI_COMPATIBLE_BASE_URL: server.baseUrl });

    expect(server.headers).toHaveLength(1);
    const sent = [...(server.headers[0] ?? new Headers()).values()].join("\n");
    for (const marker of Object.values(MARKERS)) {
      expect(sent).not.toContain(marker);
    }
  });

  test("互換接続先用のキーだけをAuthorizationで送る", async () => {
    setEnvironment("OPENAI_API_KEY", MARKERS.OPENAI_API_KEY);
    const server = startRecordingServer();

    await callOnce({
      SEKISYO_OPENAI_COMPATIBLE_API_KEY: "compatible-key",
      SEKISYO_OPENAI_COMPATIBLE_BASE_URL: server.baseUrl
    });

    expect(server.headers[0]?.get("authorization")).toBe(
      "Bearer compatible-key"
    );
  });
});
