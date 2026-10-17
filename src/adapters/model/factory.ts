import type { QaModelSelection } from "../../config/model.ts";
import type { QaModelProvider } from "../../domain/qa-model-provider.ts";
import type { ReviewStrictness } from "../../domain/strictness.ts";
import type {
  AnswerJudgmentInput,
  QaModel,
  QaSummaryInput,
  QuestionGenerationInput
} from "../../ports/qa-model.ts";
import {
  createOpenAIQaModel,
  createOpenAIStructuredClient
} from "../openai/qa-model.ts";
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

// 各社 SDK は読み込みだけで数十 ms かかり、pre-push フックは push のたびに CLI を
// 起動する。使う provider の SDK だけを、最初の呼び出し時に読み込む。
export async function loadStructuredOutputClient(
  provider: QaModelProvider,
  timeoutMs: number
): Promise<StructuredOutputClient> {
  switch (provider) {
    case "openai":
      return createOpenAIStructuredClient({ timeoutMs });
    case "anthropic": {
      const { createAnthropicStructuredClient } =
        await import("../anthropic/qa-client.ts");
      return createAnthropicStructuredClient({ timeoutMs });
    }
    case "google": {
      const { createGoogleStructuredClient } =
        await import("../google/qa-client.ts");
      return createGoogleStructuredClient();
    }
    case "openai-compatible": {
      const { createOpenAICompatibleStructuredClient } =
        await import("../openai/compatible-client.ts");
      return createOpenAICompatibleStructuredClient({ timeoutMs });
    }
  }
}

class LazyQaModel implements QaModel {
  readonly #load: () => Promise<QaModel>;
  #model: Promise<QaModel> | undefined;

  constructor(load: () => Promise<QaModel>) {
    this.#load = load;
  }

  #resolve(): Promise<QaModel> {
    this.#model ??= this.#load();
    return this.#model;
  }

  async generateQuestions(
    input: QuestionGenerationInput,
    signal?: AbortSignal
  ): ReturnType<QaModel["generateQuestions"]> {
    return (await this.#resolve()).generateQuestions(input, signal);
  }

  async judgeAnswer(
    input: AnswerJudgmentInput,
    signal?: AbortSignal
  ): ReturnType<QaModel["judgeAnswer"]> {
    return (await this.#resolve()).judgeAnswer(input, signal);
  }

  async summarize(
    input: QaSummaryInput,
    signal?: AbortSignal
  ): ReturnType<QaModel["summarize"]> {
    return (await this.#resolve()).summarize(input, signal);
  }
}

export function createQaModel(options: CreateQaModelOptions): QaModel {
  const { selection, strictness } = options;
  // OpenAI は既存の Responses API 経路（createOpenAIQaModel）をそのまま使う。
  if (selection.provider === "openai") {
    return createOpenAIQaModel({ model: selection.model, strictness });
  }
  const provider = selection.provider;
  return new LazyQaModel(async () => {
    const client = await loadStructuredOutputClient(
      provider,
      DEFAULT_QA_TIMEOUT_MS
    );
    const resolved = resolveStructuredQaModelOptions({
      model: selection.model,
      strictness
    });
    if (resolved === undefined) {
      throw client.createError("invalid_input");
    }
    return new StructuredQaModel(client, resolved);
  });
}
