export type ModelAdapterErrorCode =
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

// 利用者に表示されるため、プロバイダの応答本文や要求内容は含めない。
function safeMessage(provider: string, code: ModelAdapterErrorCode): string {
  switch (code) {
    case "aborted":
      return `The ${provider} request was cancelled.`;
    case "authentication":
      return `${provider} authentication failed.`;
    case "connection":
      return `Could not connect to ${provider}.`;
    case "incomplete":
      return `${provider} returned an incomplete response.`;
    case "invalid_input":
      return `The ${provider} adapter received invalid input.`;
    case "invalid_request":
      return `${provider} rejected the request.`;
    case "invalid_response":
      return `${provider} returned an invalid structured response.`;
    case "missing_parsed_output":
      return `${provider} returned no parsed structured output.`;
    case "not_found":
      return `The requested ${provider} resource was not found.`;
    case "permission":
      return `${provider} denied access to the requested resource.`;
    case "quota_exhausted":
      return `The ${provider} account has no available quota.`;
    case "rate_limit":
      return `The ${provider} rate limit was reached.`;
    case "refusal":
      return `${provider} refused to produce the requested structured output.`;
    case "response_failed":
      return `${provider} could not complete the response.`;
    case "server":
      return `${provider} encountered a server error.`;
    case "timeout":
      return `The ${provider} request timed out.`;
    case "unknown":
      return `The ${provider} request failed.`;
  }
}

export interface ModelAdapterErrorOptions {
  readonly requestId?: string;
  readonly retryable?: boolean;
}

export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(
    provider: string,
    code: ModelAdapterErrorCode,
    options: ModelAdapterErrorOptions = {}
  ) {
    super(safeMessage(provider, code));
    this.name = "ModelAdapterError";
    this.code = code;
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
  }
}

export type ModelAdapterErrorFactory = (
  code: ModelAdapterErrorCode,
  options?: ModelAdapterErrorOptions
) => ModelAdapterError;

/** HTTP ステータスからの分類。各 SDK の例外クラスの判定後に共通で使う。 */
export function classifyHttpStatus(
  status: number | undefined,
  createError: ModelAdapterErrorFactory,
  options: { readonly quotaExhausted?: boolean; readonly requestId?: string }
): ModelAdapterError {
  const base =
    options.requestId === undefined ? {} : { requestId: options.requestId };
  if (status === 401) {
    return createError("authentication", base);
  }
  if (status === 403) {
    return createError("permission", base);
  }
  if (status === 404) {
    return createError("not_found", base);
  }
  if (status === 429) {
    return options.quotaExhausted === true
      ? createError("quota_exhausted", base)
      : createError("rate_limit", { ...base, retryable: true });
  }
  if (status !== undefined && status >= 500) {
    return createError("server", { ...base, retryable: true });
  }
  if (status === 400 || status === 409 || status === 422) {
    return createError("invalid_request", {
      ...base,
      retryable: status === 409
    });
  }
  return createError("unknown", base);
}
