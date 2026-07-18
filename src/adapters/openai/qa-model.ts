import OpenAI from "openai";
import type { z } from "zod";

import {
  buildAnswerJudgmentPrompt,
  buildFollowUpPrompt,
  buildQaSummaryPrompt,
  buildQuestionGenerationPrompt,
  type ModelPrompt
} from "../../prompts/index.ts";
import type {
  AnswerJudgmentInput,
  FollowUpGenerationInput,
  QaModel,
  QaSummaryInput,
  QuestionGenerationInput
} from "../../ports/qa-model.ts";
import {
  answerJudgmentWireSchema,
  followUpQuestionWireSchema,
  qaSummaryWireSchema,
  questionListWireSchema,
  toAnswerJudgment,
  toQaSummary,
  toQuestion
} from "../../schemas/questions.ts";
import type {
  AnswerJudgment,
  QaSummary,
  Question
} from "../../domain/questions.ts";
import { BUILT_IN_QUESTION_CATEGORIES } from "../../domain/questions.ts";
import { classifyOpenAIError, OpenAIAdapterError } from "./errors.ts";
import {
  type OpenAIReasoningEffort,
  type OpenAIResponsesClient,
  OpenAISdkResponsesClient,
  type StructuredResponse
} from "./responses-client.ts";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
export const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;

const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const MAX_QUESTION_COUNT = 20;
const BUILT_IN_CATEGORY_NAMES = new Set<string>(BUILT_IN_QUESTION_CATEGORIES);

export interface OpenAIQaModelOptions {
  readonly maxOutputTokens?: number;
  readonly model?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly timeoutMs?: number;
}

export interface CreateOpenAIQaModelOptions extends OpenAIQaModelOptions {
  readonly apiKey?: string;
  readonly maxRetries?: number;
}

interface ResolvedOpenAIQaModelOptions {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly reasoningEffort: OpenAIReasoningEffort;
  readonly timeoutMs: number;
}

function requirePositiveInteger(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new OpenAIAdapterError("invalid_input");
  }
}

function resolveOptions(
  options: OpenAIQaModelOptions
): ResolvedOpenAIQaModelOptions {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  requirePositiveInteger(timeoutMs);
  requirePositiveInteger(maxOutputTokens);

  const model = options.model?.trim() ?? DEFAULT_OPENAI_MODEL;
  if (model.length === 0) {
    throw new OpenAIAdapterError("invalid_input");
  }

  return {
    maxOutputTokens,
    model,
    reasoningEffort: options.reasoningEffort ?? "low",
    timeoutMs
  };
}

export class OpenAIQaModel implements QaModel {
  readonly #client: OpenAIResponsesClient;
  readonly #options: ResolvedOpenAIQaModelOptions;

  constructor(
    client: OpenAIResponsesClient,
    options: OpenAIQaModelOptions = {}
  ) {
    this.#client = client;
    this.#options = resolveOptions(options);
  }

  async #parse<Schema extends z.ZodType>(
    schema: Schema,
    schemaName: string,
    prompt: ModelPrompt,
    signal?: AbortSignal
  ): Promise<z.output<Schema>> {
    let response: StructuredResponse<z.output<Schema>>;
    try {
      response = await this.#client.parse(
        {
          maxOutputTokens: this.#options.maxOutputTokens,
          model: this.#options.model,
          prompt,
          reasoningEffort: this.#options.reasoningEffort,
          schema,
          schemaName,
          timeoutMs: this.#options.timeoutMs
        },
        signal
      );
    } catch (error) {
      throw classifyOpenAIError(error);
    }

    if (response.status === "incomplete") {
      throw new OpenAIAdapterError("incomplete");
    }

    if (response.failed) {
      throw new OpenAIAdapterError("response_failed");
    }

    if (response.refused) {
      throw new OpenAIAdapterError("refusal");
    }

    if (response.parsed === null) {
      throw new OpenAIAdapterError("missing_parsed_output");
    }

    return response.parsed;
  }

  async generateQuestions(
    input: QuestionGenerationInput,
    signal?: AbortSignal
  ): Promise<readonly Question[]> {
    const requiredCategoryCount = input.categories.filter(
      (category) => category.required
    ).length;
    if (
      !Number.isInteger(input.questionCount) ||
      input.questionCount < 1 ||
      input.questionCount > MAX_QUESTION_COUNT ||
      requiredCategoryCount > input.questionCount
    ) {
      throw new OpenAIAdapterError("invalid_input");
    }

    const output = await this.#parse(
      questionListWireSchema,
      "sekisyo_questions",
      buildQuestionGenerationPrompt(input),
      signal
    );
    if (output.questions.length !== input.questionCount) {
      throw new OpenAIAdapterError("invalid_response");
    }

    const questions = output.questions.map(toQuestion);
    if (
      new Set(questions.map((question) => question.id)).size !==
      questions.length
    ) {
      throw new OpenAIAdapterError("invalid_response");
    }

    const requestedBuiltIns = new Set(
      input.categories
        .filter((category) => BUILT_IN_CATEGORY_NAMES.has(category.name))
        .map((category) => category.name)
    );
    const generatedCategories = new Set(
      questions.map((question) => question.category)
    );
    const generatedCustomCount = questions.filter(
      (question) => question.category === "custom"
    ).length;
    const requiredCustomCount = input.categories.filter(
      (category) =>
        category.required && !BUILT_IN_CATEGORY_NAMES.has(category.name)
    ).length;
    const includesDisabledBuiltIn = questions.some(
      (question) =>
        question.category !== "custom" &&
        !requestedBuiltIns.has(question.category)
    );
    const missesRequiredCategory = input.categories.some(
      (category) =>
        category.required &&
        BUILT_IN_CATEGORY_NAMES.has(category.name) &&
        !generatedCategories.has(category.name as Question["category"])
    );
    if (
      includesDisabledBuiltIn ||
      missesRequiredCategory ||
      generatedCustomCount < requiredCustomCount
    ) {
      throw new OpenAIAdapterError("invalid_response");
    }
    return questions;
  }

  async judgeAnswer(
    input: AnswerJudgmentInput,
    signal?: AbortSignal
  ): Promise<AnswerJudgment> {
    if (input.answer.trim().length === 0) {
      throw new OpenAIAdapterError("invalid_input");
    }

    const output = await this.#parse(
      answerJudgmentWireSchema,
      "sekisyo_answer_judgment",
      buildAnswerJudgmentPrompt(input),
      signal
    );
    return toAnswerJudgment(output);
  }

  async generateFollowUp(
    input: FollowUpGenerationInput,
    signal?: AbortSignal
  ): Promise<Question | null> {
    if (input.judgment.passed) {
      return null;
    }

    const output = await this.#parse(
      followUpQuestionWireSchema,
      "sekisyo_follow_up",
      buildFollowUpPrompt(input),
      signal
    );
    return output.followUp === null ? null : toQuestion(output.followUp);
  }

  async summarize(
    input: QaSummaryInput,
    signal?: AbortSignal
  ): Promise<QaSummary> {
    const output = await this.#parse(
      qaSummaryWireSchema,
      "sekisyo_qa_summary",
      buildQaSummaryPrompt(input),
      signal
    );
    return toQaSummary(output);
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
