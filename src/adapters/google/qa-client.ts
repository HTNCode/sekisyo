import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  classifyHttpStatus,
  ModelAdapterError,
  type ModelAdapterErrorCode,
  type ModelAdapterErrorFactory
} from "../model/errors.ts";
import type {
  StructuredOutputClient,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../model/structured-client.ts";

// 安全性やポリシーで生成を止めた終了理由。部分的な出力が残っていても使わない。
const REFUSAL_FINISH_REASONS: ReadonlySet<string> = new Set([
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.RECITATION,
  FinishReason.SAFETY,
  FinishReason.SPII
]);

export class GoogleAdapterError extends ModelAdapterError {
  constructor(
    code: ModelAdapterErrorCode,
    options: { readonly requestId?: string; readonly retryable?: boolean } = {}
  ) {
    super("Google Gemini", code, options);
    this.name = "GoogleAdapterError";
  }
}

const createGoogleError: ModelAdapterErrorFactory = (code, options) =>
  new GoogleAdapterError(code, options);

export function classifyGoogleError(error: unknown): ModelAdapterError {
  if (error instanceof ModelAdapterError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return createGoogleError("aborted");
  }
  if (error instanceof ApiError) {
    return classifyHttpStatus(error.status, createGoogleError, {});
  }
  return createGoogleError("unknown");
}

export interface GoogleGeneratedContent {
  readonly blocked: boolean;
  readonly finishReason: string | undefined;
  readonly text: string | undefined;
}

/** SDK 呼び出しだけを切り出した境界。テストではこれを差し替える。 */
export interface GoogleContentGenerator {
  generate(
    request: StructuredOutputRequest<z.ZodType>,
    signal?: AbortSignal
  ): Promise<GoogleGeneratedContent>;
}

export class GoogleSdkContentGenerator implements GoogleContentGenerator {
  readonly #client: GoogleGenAI;

  constructor(client: GoogleGenAI) {
    this.#client = client;
  }

  async generate(
    request: StructuredOutputRequest<z.ZodType>,
    signal?: AbortSignal
  ): Promise<GoogleGeneratedContent> {
    // Claude Code が draft 2020-12 の "$schema" 宣言を解決できず失敗したのと同じ
    // 事態を避けるため、キーワードは残して宣言だけを外す。
    const { $schema: _declaration, ...responseJsonSchema } = z.toJSONSchema(
      request.schema
    );
    const response = await this.#client.models.generateContent({
      model: request.model,
      contents: request.prompt.input,
      config: {
        systemInstruction: request.prompt.instructions,
        responseMimeType: "application/json",
        responseJsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        httpOptions: { timeout: request.timeoutMs },
        ...(signal === undefined ? {} : { abortSignal: signal })
      }
    });
    return {
      blocked: response.promptFeedback?.blockReason !== undefined,
      finishReason: response.candidates?.[0]?.finishReason,
      text: response.text
    };
  }
}

export class GoogleStructuredClient implements StructuredOutputClient {
  readonly #generator: GoogleContentGenerator;

  constructor(generator: GoogleContentGenerator) {
    this.#generator = generator;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredOutputResult<z.output<Schema>>> {
    const content = await this.#generator.generate(request, signal);
    const refused =
      content.blocked ||
      (content.finishReason !== undefined &&
        REFUSAL_FINISH_REASONS.has(content.finishReason));
    const incomplete = content.finishReason === FinishReason.MAX_TOKENS;
    if (refused || incomplete || content.text === undefined) {
      return { failed: false, incomplete, parsed: null, refused };
    }
    // Gemini の JSON Schema 指定は形を誘導するだけなので、受け取り側で検証する。
    let candidate: unknown;
    try {
      candidate = JSON.parse(content.text);
    } catch {
      throw this.createError("invalid_response");
    }
    const parsed = request.schema.safeParse(candidate);
    if (!parsed.success) {
      throw this.createError("invalid_response");
    }
    return { failed: false, incomplete, parsed: parsed.data, refused };
  }

  classifyError(error: unknown): ModelAdapterError {
    return classifyGoogleError(error);
  }

  createError(code: ModelAdapterErrorCode): ModelAdapterError {
    return new GoogleAdapterError(code);
  }
}

export function createGoogleStructuredClient(
  environment: Readonly<Record<string, string | undefined>> = process.env
): GoogleStructuredClient {
  const apiKey = environment.GEMINI_API_KEY ?? environment.GOOGLE_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new GoogleAdapterError("authentication");
  }
  return new GoogleStructuredClient(
    new GoogleSdkContentGenerator(new GoogleGenAI({ apiKey }))
  );
}
