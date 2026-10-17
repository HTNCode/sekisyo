import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ZodError } from "zod";

import {
  classifyHttpStatus,
  ModelAdapterError,
  type ModelAdapterErrorCode,
  type ModelAdapterErrorFactory
} from "../model/errors.ts";
import type {
  ReasoningEffort,
  StructuredOutputClient,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../model/structured-client.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

// 思考は常に有効なので、出力上限が小さいと構造化出力の前に打ち切られる。
const MIN_ANTHROPIC_MAX_TOKENS = 16_000;

// 安全性の判断で断られたとき、サーバー側で代替モデルに再実行させる。
// "default" 指定はこのモデル群でのみ受け付けられ、それ以外へ送ると 400 になる。
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SERVER_FALLBACK_MODELS: ReadonlySet<string> = new Set([
  "claude-fable-5-1",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5"
]);

type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** none / minimal は受け付けられないため、最も軽い low に寄せる。 */
export function toAnthropicEffort(effort: ReasoningEffort): AnthropicEffort {
  return effort === "none" || effort === "minimal" ? "low" : effort;
}

export class AnthropicAdapterError extends ModelAdapterError {
  constructor(
    code: ModelAdapterErrorCode,
    options: { readonly requestId?: string; readonly retryable?: boolean } = {}
  ) {
    super("Anthropic", code, options);
    this.name = "AnthropicAdapterError";
  }
}

const createAnthropicError: ModelAdapterErrorFactory = (code, options) =>
  new AnthropicAdapterError(code, options);

export function classifyAnthropicError(error: unknown): ModelAdapterError {
  if (error instanceof ModelAdapterError) {
    return error;
  }
  if (error instanceof APIUserAbortError) {
    return createAnthropicError("aborted");
  }
  if (error instanceof APIConnectionTimeoutError) {
    return createAnthropicError("timeout", { retryable: true });
  }
  if (error instanceof APIConnectionError) {
    return createAnthropicError("connection", { retryable: true });
  }
  if (error instanceof ZodError) {
    return createAnthropicError("invalid_response");
  }
  if (!(error instanceof APIError)) {
    return createAnthropicError("unknown");
  }
  return classifyHttpStatus(error.status, createAnthropicError, {
    ...(error.requestID === null || error.requestID === undefined
      ? {}
      : { requestId: error.requestID })
  });
}

export interface AnthropicParsedMessage<Output> {
  readonly parsed: Output | null;
  readonly stopReason: string | null;
}

/** SDK 呼び出しだけを切り出した境界。テストではこれを差し替える。 */
export interface AnthropicMessagesParser {
  parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<AnthropicParsedMessage<z.output<Schema>>>;
}

export class AnthropicSdkMessagesParser implements AnthropicMessagesParser {
  readonly #client: Anthropic;

  constructor(client: Anthropic) {
    this.#client = client;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<AnthropicParsedMessage<z.output<Schema>>> {
    const usesFallback = SERVER_FALLBACK_MODELS.has(request.model);
    const message = await this.#client.beta.messages.parse(
      {
        model: request.model,
        max_tokens: Math.max(request.maxOutputTokens, MIN_ANTHROPIC_MAX_TOKENS),
        system: request.prompt.instructions,
        messages: [{ role: "user", content: request.prompt.input }],
        output_config: {
          effort: toAnthropicEffort(request.reasoningEffort),
          format: betaZodOutputFormat(request.schema)
        },
        ...(usesFallback
          ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const }
          : {})
      },
      { signal, timeout: request.timeoutMs }
    );
    return {
      // ジェネリックな Schema では、SDK が推論する型と z.output<Schema> の
      // 同一性を TS が証明できない（OpenAI 側の responses-client と同じ事情）
      parsed: message.parsed_output as z.output<Schema> | null,
      stopReason: message.stop_reason
    };
  }
}

export class AnthropicStructuredClient implements StructuredOutputClient {
  readonly #parser: AnthropicMessagesParser;

  constructor(parser: AnthropicMessagesParser) {
    this.#parser = parser;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredOutputResult<z.output<Schema>>> {
    const message = await this.#parser.parse(request, signal);
    const refused = message.stopReason === "refusal";
    const incomplete = message.stopReason === "max_tokens";
    return {
      failed: false,
      incomplete,
      // 打ち切りや拒否の応答に残った途中の出力は信用しない。
      parsed: refused || incomplete ? null : message.parsed,
      refused
    };
  }

  classifyError(error: unknown): ModelAdapterError {
    return classifyAnthropicError(error);
  }

  createError(code: ModelAdapterErrorCode): ModelAdapterError {
    return new AnthropicAdapterError(code);
  }
}

export function createAnthropicStructuredClient(options: {
  readonly maxRetries?: number;
  readonly timeoutMs: number;
}): AnthropicStructuredClient {
  // 認証情報は SDK の既定の解決順（ANTHROPIC_API_KEY など）に任せる。
  const client = new Anthropic({
    maxRetries: options.maxRetries ?? 2,
    timeout: options.timeoutMs
  });
  return new AnthropicStructuredClient(new AnthropicSdkMessagesParser(client));
}
