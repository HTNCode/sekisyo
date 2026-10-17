import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from "openai";
import { ZodError } from "zod";

import {
  classifyHttpStatus,
  ModelAdapterError,
  type ModelAdapterErrorCode,
  type ModelAdapterErrorFactory,
  type ModelAdapterErrorOptions
} from "../model/errors.ts";

export type OpenAIAdapterErrorCode = ModelAdapterErrorCode;

export class OpenAIAdapterError extends ModelAdapterError {
  constructor(
    code: OpenAIAdapterErrorCode,
    options: ModelAdapterErrorOptions = {}
  ) {
    super("OpenAI", code, options);
    this.name = "OpenAIAdapterError";
  }
}

const createOpenAIError: ModelAdapterErrorFactory = (code, options) =>
  new OpenAIAdapterError(code, options);

/**
 * openai SDK の例外を分類する。OpenAI 互換の接続先も同じ SDK を使うため、
 * どのプロバイダ名で報告するかは createError で切り替える。
 */
export function classifyOpenAIError(
  error: unknown,
  createError: ModelAdapterErrorFactory = createOpenAIError
): ModelAdapterError {
  if (error instanceof ModelAdapterError) {
    return error;
  }
  if (error instanceof APIUserAbortError) {
    return createError("aborted");
  }
  if (error instanceof APIConnectionTimeoutError) {
    return createError("timeout", { retryable: true });
  }
  if (error instanceof APIConnectionError) {
    return createError("connection", { retryable: true });
  }
  if (error instanceof ZodError) {
    return createError("invalid_response");
  }
  if (!(error instanceof APIError)) {
    return createError("unknown");
  }
  return classifyHttpStatus(error.status, createError, {
    quotaExhausted:
      error.code === "insufficient_quota" ||
      error.type === "insufficient_quota",
    ...(error.requestID === null || error.requestID === undefined
      ? {}
      : { requestId: error.requestID })
  });
}
