import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from "openai";
import { ZodError } from "zod";

export type OpenAIAdapterErrorCode =
  | "aborted"
  | "authentication"
  | "connection"
  | "incomplete"
  | "invalid_input"
  | "invalid_request"
  | "invalid_response"
  | "missing_parsed_output"
  | "not_found"
  | "permission"
  | "quota_exhausted"
  | "rate_limit"
  | "refusal"
  | "response_failed"
  | "server"
  | "timeout"
  | "unknown";

const SAFE_MESSAGES: Readonly<Record<OpenAIAdapterErrorCode, string>> = {
  aborted: "The OpenAI request was cancelled.",
  authentication: "OpenAI authentication failed.",
  connection: "Could not connect to OpenAI.",
  incomplete: "OpenAI returned an incomplete response.",
  invalid_input: "The OpenAI adapter received invalid input.",
  invalid_request: "OpenAI rejected the request.",
  invalid_response: "OpenAI returned an invalid structured response.",
  missing_parsed_output: "OpenAI returned no parsed structured output.",
  not_found: "The requested OpenAI resource was not found.",
  permission: "OpenAI denied access to the requested resource.",
  quota_exhausted: "The OpenAI account has no available quota.",
  rate_limit: "The OpenAI rate limit was reached.",
  refusal: "OpenAI refused to produce the requested structured output.",
  response_failed: "OpenAI could not complete the response.",
  server: "OpenAI encountered a server error.",
  timeout: "The OpenAI request timed out.",
  unknown: "The OpenAI request failed."
};

export class OpenAIAdapterError extends Error {
  readonly code: OpenAIAdapterErrorCode;
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(
    code: OpenAIAdapterErrorCode,
    options: {
      readonly requestId?: string;
      readonly retryable?: boolean;
    } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "OpenAIAdapterError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
  }
}

function apiErrorOptions(
  error: APIError,
  retryable: boolean
): {
  readonly requestId?: string;
  readonly retryable: boolean;
} {
  return {
    retryable,
    ...(error.requestID === null || error.requestID === undefined
      ? {}
      : { requestId: error.requestID })
  };
}

export function classifyOpenAIError(error: unknown): OpenAIAdapterError {
  if (error instanceof OpenAIAdapterError) {
    return error;
  }

  if (error instanceof APIUserAbortError) {
    return new OpenAIAdapterError("aborted");
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAIAdapterError("timeout", { retryable: true });
  }

  if (error instanceof APIConnectionError) {
    return new OpenAIAdapterError("connection", { retryable: true });
  }

  if (error instanceof ZodError) {
    return new OpenAIAdapterError("invalid_response");
  }

  if (!(error instanceof APIError)) {
    return new OpenAIAdapterError("unknown");
  }

  if (error.status === 401) {
    return new OpenAIAdapterError(
      "authentication",
      apiErrorOptions(error, false)
    );
  }

  if (error.status === 403) {
    return new OpenAIAdapterError("permission", apiErrorOptions(error, false));
  }

  if (error.status === 404) {
    return new OpenAIAdapterError("not_found", apiErrorOptions(error, false));
  }

  if (error.status === 429) {
    const quotaExhausted =
      error.code === "insufficient_quota" ||
      error.type === "insufficient_quota";
    return new OpenAIAdapterError(
      quotaExhausted ? "quota_exhausted" : "rate_limit",
      apiErrorOptions(error, !quotaExhausted)
    );
  }

  if (error.status !== undefined && error.status >= 500) {
    return new OpenAIAdapterError("server", apiErrorOptions(error, true));
  }

  if (error.status === 400 || error.status === 409 || error.status === 422) {
    return new OpenAIAdapterError(
      "invalid_request",
      apiErrorOptions(error, error.status === 409)
    );
  }

  return new OpenAIAdapterError("unknown", apiErrorOptions(error, false));
}
