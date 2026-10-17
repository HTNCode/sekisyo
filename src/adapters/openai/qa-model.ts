import OpenAI from "openai";
import type { z } from "zod";

import type { ReviewStrictness } from "../../domain/strictness.ts";
import type { ModelAdapterError } from "../model/errors.ts";
import type {
  StructuredOutputClient,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../model/structured-client.ts";
import {
  DEFAULT_QA_TIMEOUT_MS,
  resolveStructuredQaModelOptions,
  StructuredQaModel,
  type ResolvedStructuredQaModelOptions
} from "../model/structured-qa-model.ts";
import {
  classifyOpenAIError,
  OpenAIAdapterError,
  type OpenAIAdapterErrorCode
} from "./errors.ts";
import {
  type OpenAIReasoningEffort,
  type OpenAIResponsesClient,
  OpenAISdkResponsesClient
} from "./responses-client.ts";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
export const DEFAULT_OPENAI_TIMEOUT_MS = DEFAULT_QA_TIMEOUT_MS;

export interface OpenAIQaModelOptions {
  readonly maxOutputTokens?: number;
  readonly model?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly strictness?: ReviewStrictness;
  readonly timeoutMs?: number;
}

export interface CreateOpenAIQaModelOptions extends OpenAIQaModelOptions {
  readonly apiKey?: string;
  readonly maxRetries?: number;
}

/** Responses API の応答を、プロバイダ共通の状態へ揃える。 */
export class OpenAIResponsesStructuredClient implements StructuredOutputClient {
  readonly #client: OpenAIResponsesClient;

  constructor(client: OpenAIResponsesClient) {
    this.#client = client;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredOutputResult<z.output<Schema>>> {
    const response = await this.#client.parse(request, signal);
    return {
      failed: response.failed,
      incomplete: response.status === "incomplete",
      parsed: response.parsed,
      refused: response.refused
    };
  }

  classifyError(error: unknown): ModelAdapterError {
    return classifyOpenAIError(error);
  }

  createError(code: OpenAIAdapterErrorCode): ModelAdapterError {
    return new OpenAIAdapterError(code);
  }
}

function resolveOptions(
  options: OpenAIQaModelOptions
): ResolvedStructuredQaModelOptions {
  const resolved = resolveStructuredQaModelOptions({
    ...options,
    model: options.model ?? DEFAULT_OPENAI_MODEL
  });
  if (resolved === undefined) {
    throw new OpenAIAdapterError("invalid_input");
  }
  return resolved;
}

export class OpenAIQaModel extends StructuredQaModel {
  constructor(
    client: OpenAIResponsesClient,
    options: OpenAIQaModelOptions = {}
  ) {
    super(new OpenAIResponsesStructuredClient(client), resolveOptions(options));
  }
}

export function createOpenAIQaModel(
  options: CreateOpenAIQaModelOptions = {}
): OpenAIQaModel {
  const resolvedOptions = resolveOptions(options);
  const client = new OpenAI({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    maxRetries: options.maxRetries ?? 2,
    timeout: resolvedOptions.timeoutMs
  });
  return new OpenAIQaModel(
    new OpenAISdkResponsesClient(client),
    resolvedOptions
  );
}

/** 差分解析など、Q&A 以外で Responses API の構造化出力を使うときのクライアント。 */
export function createOpenAIStructuredClient(options: {
  readonly maxRetries?: number;
  readonly timeoutMs: number;
}): OpenAIResponsesStructuredClient {
  return new OpenAIResponsesStructuredClient(
    new OpenAISdkResponsesClient(
      new OpenAI({
        maxRetries: options.maxRetries ?? 2,
        timeout: options.timeoutMs
      })
    )
  );
}
