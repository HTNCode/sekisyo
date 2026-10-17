import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

import {
  ModelAdapterError,
  type ModelAdapterErrorCode,
  type ModelAdapterErrorFactory
} from "../model/errors.ts";
import type {
  StructuredOutputClient,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../model/structured-client.ts";
import { classifyOpenAIError } from "./errors.ts";

// 接続先とキーは利用者の環境変数からだけ受け取る。コミットされる .sekisyo.yml に
// 書けると、そのリポジトリを clone して push しただけでキーや Q&A が任意の
// 宛先へ送られてしまう。
export const OPENAI_COMPATIBLE_BASE_URL_ENV =
  "SEKISYO_OPENAI_COMPATIBLE_BASE_URL";
export const OPENAI_COMPATIBLE_API_KEY_ENV =
  "SEKISYO_OPENAI_COMPATIBLE_API_KEY";

// ローカルの推論サーバーはキーを要求しないことが多い。SDK はキー未指定だと
// OPENAI_API_KEY を読みに行き、本物の OpenAI のキーを第三者へ送ってしまうため、
// キーが無い場合も必ずこの値を明示する。
const PLACEHOLDER_API_KEY = "sekisyo-no-api-key";

export class OpenAICompatibleAdapterError extends ModelAdapterError {
  constructor(
    code: ModelAdapterErrorCode,
    options: { readonly requestId?: string; readonly retryable?: boolean } = {}
  ) {
    super("OpenAI-compatible endpoint", code, options);
    this.name = "OpenAICompatibleAdapterError";
  }
}

const createCompatibleError: ModelAdapterErrorFactory = (code, options) =>
  new OpenAICompatibleAdapterError(code, options);

export interface ChatCompletionResult<Output> {
  readonly finishReason: string | null;
  readonly parsed: Output | null;
  readonly refusal: string | null;
}

/** SDK 呼び出しだけを切り出した境界。テストではこれを差し替える。 */
export interface ChatCompletionParser {
  parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult<z.output<Schema>> | undefined>;
}

export class OpenAISdkChatCompletionParser implements ChatCompletionParser {
  readonly #client: OpenAI;

  constructor(client: OpenAI) {
    this.#client = client;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult<z.output<Schema>> | undefined> {
    // 互換サーバーの多くは reasoning 指定や max_completion_tokens を解さないため送らない。
    const completion = await this.#client.chat.completions.parse(
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: [
          { role: "system", content: request.prompt.instructions },
          { role: "user", content: request.prompt.input }
        ],
        response_format: zodResponseFormat(request.schema, request.schemaName)
      },
      { signal, timeout: request.timeoutMs }
    );
    const choice = completion.choices[0];
    if (choice === undefined) {
      return undefined;
    }
    return {
      finishReason: choice.finish_reason,
      // responses-client と同じく、ジェネリックな Schema との同一性は TS が証明できない
      parsed: choice.message.parsed as z.output<Schema> | null,
      refusal: choice.message.refusal
    };
  }
}

export class OpenAICompatibleStructuredClient implements StructuredOutputClient {
  readonly #parser: ChatCompletionParser;

  constructor(parser: ChatCompletionParser) {
    this.#parser = parser;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredOutputResult<z.output<Schema>>> {
    const result = await this.#parser.parse(request, signal);
    if (result === undefined) {
      return { failed: true, incomplete: false, parsed: null, refused: false };
    }
    const refused =
      result.refusal !== null || result.finishReason === "content_filter";
    const incomplete = result.finishReason === "length";
    return {
      failed: false,
      incomplete,
      parsed: refused || incomplete ? null : result.parsed,
      refused
    };
  }

  classifyError(error: unknown): ModelAdapterError {
    return classifyOpenAIError(error, createCompatibleError);
  }

  createError(code: ModelAdapterErrorCode): ModelAdapterError {
    return new OpenAICompatibleAdapterError(code);
  }
}

/** 環境変数から接続先を読む。http(s) 以外や資格情報入りの URL は受け付けない。 */
export function readOpenAICompatibleBaseUrl(
  environment: Readonly<Record<string, string | undefined>>
): string {
  const raw = environment[OPENAI_COMPATIBLE_BASE_URL_ENV]?.trim();
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      `provider: openai-compatible を使うには環境変数 ${OPENAI_COMPATIBLE_BASE_URL_ENV} に接続先URLを設定してください。`
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${OPENAI_COMPATIBLE_BASE_URL_ENV} が URL ではありません。`
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `${OPENAI_COMPATIBLE_BASE_URL_ENV} は http または https の URL にしてください。`
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(
      `${OPENAI_COMPATIBLE_BASE_URL_ENV} に資格情報を含めず、キーは ${OPENAI_COMPATIBLE_API_KEY_ENV} で渡してください。`
    );
  }
  return url.toString();
}

export function createOpenAICompatibleStructuredClient(options: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maxRetries?: number;
  readonly timeoutMs: number;
}): OpenAICompatibleStructuredClient {
  const environment = options.environment ?? process.env;
  const apiKey = environment[OPENAI_COMPATIBLE_API_KEY_ENV]?.trim();
  const client = new OpenAI({
    apiKey:
      apiKey === undefined || apiKey.length === 0
        ? PLACEHOLDER_API_KEY
        : apiKey,
    baseURL: readOpenAICompatibleBaseUrl(environment),
    // SDK が OPENAI_ADMIN_KEY / OPENAI_ORG_ID / OPENAI_PROJECT_ID を読んで
    // 第三者へ送らないよう明示的に空にする。
    adminAPIKey: null,
    organization: null,
    project: null,
    maxRetries: options.maxRetries ?? 2,
    timeout: options.timeoutMs
  });
  return new OpenAICompatibleStructuredClient(
    new OpenAISdkChatCompletionParser(client)
  );
}
