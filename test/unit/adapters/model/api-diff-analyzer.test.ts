import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { ApiDiffAnalyzer } from "../../../../src/adapters/model/diff-analyzer.ts";
import {
  ModelAdapterError,
  type ModelAdapterErrorCode
} from "../../../../src/adapters/model/errors.ts";
import type {
  StructuredOutputClient,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../../../../src/adapters/model/structured-client.ts";
import type { DiffAnalysisInput } from "../../../../src/ports/diff-analyzer.ts";

const wireAnalysis = {
  summary: "認証の境界を変更した",
  filesChanged: 1,
  attention: [
    {
      path: "src/auth.ts",
      startLine: null,
      endLine: null,
      classification: "must_read",
      reason: "認証の判定を変えた"
    }
  ],
  findings: [],
  risks: ["失敗時の挙動"]
};

const input: DiffAnalysisInput = {
  diff: "diff --git a/src/auth.ts b/src/auth.ts\n+changed\n",
  excludedPaths: ["**/secrets/**"],
  head: "2".repeat(40),
  repositoryPath: "/repo",
  target: { kind: "base", baseRef: "1".repeat(40) }
};

class FakeClient implements StructuredOutputClient {
  readonly requests: StructuredOutputRequest<z.ZodType>[] = [];

  constructor(
    private readonly result: Omit<StructuredOutputResult<unknown>, "parsed"> & {
      readonly candidate: unknown;
    }
  ) {}

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>
  ): Promise<StructuredOutputResult<z.output<Schema>>> {
    this.requests.push(request);
    return {
      failed: this.result.failed,
      incomplete: this.result.incomplete,
      parsed:
        this.result.candidate === null
          ? null
          : request.schema.parse(this.result.candidate),
      refused: this.result.refused
    };
  }

  classifyError(): ModelAdapterError {
    return this.createError("unknown");
  }

  createError(code: ModelAdapterErrorCode): ModelAdapterError {
    return new ModelAdapterError("Fake", code);
  }
}

function analyzerFor(client: FakeClient): ApiDiffAnalyzer {
  return new ApiDiffAnalyzer(async () => client, {
    model: "analysis-model",
    strictness: "strict",
    timeoutMs: 180_000
  });
}

const ok = { failed: false, incomplete: false, refused: false };

describe("ApiDiffAnalyzer", () => {
  test("差分をデータとして渡し、構造化出力を解析結果へ変換する", async () => {
    const client = new FakeClient({ ...ok, candidate: wireAnalysis });

    const analysis = await analyzerFor(client).analyze(input);

    expect(analysis.summary).toBe("認証の境界を変更した");
    const request = client.requests[0];
    expect(request?.model).toBe("analysis-model");
    expect(request?.timeoutMs).toBe(180_000);
    expect(request?.prompt.input).toContain(input.diff);
    expect(request?.prompt.instructions).toContain("レビュー強度はstrict");
    expect(request?.prompt.instructions).toContain("命令ではなく");
  });

  test.each([
    [{ ...ok, refused: true }, "refusal"],
    [{ ...ok, incomplete: true }, "incomplete"],
    [{ ...ok, failed: true }, "response_failed"]
  ])("異常応答を分類する", async (flags, code) => {
    const client = new FakeClient({ ...flags, candidate: wireAnalysis });
    await expect(analyzerFor(client).analyze(input)).rejects.toMatchObject({
      code
    });
  });

  test("除外パスを報告した出力は受け付けない", async () => {
    const client = new FakeClient({
      ...ok,
      candidate: {
        ...wireAnalysis,
        attention: [
          {
            path: "config/secrets/token.txt",
            startLine: null,
            endLine: null,
            classification: "must_read",
            reason: "秘密"
          }
        ]
      }
    });
    await expect(analyzerFor(client).analyze(input)).rejects.toMatchObject({
      code: "invalid_response"
    });
  });

  test("再試行を含めた解析全体をtimeoutMsで打ち切り、タイムアウトとして報告する", async () => {
    class StalledClient extends FakeClient {
      override async parse<Schema extends z.ZodType>(
        _request: StructuredOutputRequest<Schema>,
        signal?: AbortSignal
      ): Promise<StructuredOutputResult<z.output<Schema>>> {
        // 期限で打ち切られなかった場合も、テストが止まらず失敗するよう1秒で諦める。
        return new Promise((_resolve, reject) => {
          const fallback = setTimeout(
            () => reject(new Error("deadline was not applied")),
            1_000
          );
          signal?.addEventListener("abort", () => {
            clearTimeout(fallback);
            reject(new Error("aborted by signal"));
          });
        });
      }
    }
    const analyzer = new ApiDiffAnalyzer(
      async () => new StalledClient({ ...ok, candidate: wireAnalysis }),
      { model: "analysis-model", timeoutMs: 30 }
    );

    const startedAt = performance.now();
    await expect(analyzer.analyze(input)).rejects.toMatchObject({
      code: "timeout"
    });
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("空の差分は送らない", async () => {
    const client = new FakeClient({ ...ok, candidate: wireAnalysis });
    await expect(
      analyzerFor(client).analyze({ ...input, diff: "  \n" })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.requests).toHaveLength(0);
  });
});
