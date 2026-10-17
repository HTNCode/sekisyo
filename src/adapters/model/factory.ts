import type { QaModelSelection } from "../../config/model.ts";
import type { QaModelProvider } from "../../domain/qa-model-provider.ts";
import type { ReviewStrictness } from "../../domain/strictness.ts";
import type { QaModel } from "../../ports/qa-model.ts";
import { createAnthropicStructuredClient } from "../anthropic/qa-client.ts";
import { createGoogleStructuredClient } from "../google/qa-client.ts";
import { createOpenAICompatibleStructuredClient } from "../openai/compatible-client.ts";
import { createOpenAIQaModel } from "../openai/qa-model.ts";
import type { StructuredOutputClient } from "./structured-client.ts";
import {
  DEFAULT_QA_TIMEOUT_MS,
  resolveStructuredQaModelOptions,
  StructuredQaModel
} from "./structured-qa-model.ts";

export interface CreateQaModelOptions {
  readonly selection: QaModelSelection;
  readonly strictness: ReviewStrictness;
}

// OpenAI は既存の Responses API 経路（createOpenAIQaModel）をそのまま使う。
type NonOpenAIProvider = Exclude<QaModelProvider, "openai">;

function createClient(
  provider: NonOpenAIProvider,
  timeoutMs: number
): StructuredOutputClient {
  switch (provider) {
    case "anthropic":
      return createAnthropicStructuredClient({ timeoutMs });
    case "google":
      return createGoogleStructuredClient();
    case "openai-compatible":
      return createOpenAICompatibleStructuredClient({ timeoutMs });
  }
}

export function createQaModel(options: CreateQaModelOptions): QaModel {
  const { selection, strictness } = options;
  if (selection.provider === "openai") {
    return createOpenAIQaModel({ model: selection.model, strictness });
  }
  const client = createClient(selection.provider, DEFAULT_QA_TIMEOUT_MS);
  const resolved = resolveStructuredQaModelOptions({
    model: selection.model,
    strictness
  });
  if (resolved === undefined) {
    throw client.createError("invalid_input");
  }
  return new StructuredQaModel(client, resolved);
}
