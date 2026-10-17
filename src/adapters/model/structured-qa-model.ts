import type { z } from "zod";

import {
  buildAnswerJudgmentPrompt,
  buildQaSummaryPrompt,
  buildQuestionGenerationPrompt,
  type ModelPrompt
} from "../../prompts/index.ts";
import type {
  AnswerJudgmentInput,
  QaModel,
  QaSummaryInput,
  QuestionGenerationInput
} from "../../ports/qa-model.ts";
import {
  answerJudgmentWireResponseSchema,
  answerJudgmentWireSchema,
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
import {
  DEFAULT_REVIEW_STRICTNESS,
  type ReviewStrictness
} from "../../domain/strictness.ts";
import type {
  ReasoningEffort,
  StructuredOutputClient,
  StructuredOutputResult
} from "./structured-client.ts";

export const DEFAULT_QA_TIMEOUT_MS = 60_000;

const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const MAX_QUESTION_COUNT = 20;
const MAX_ANSWER_JUDGMENT_ATTEMPTS = 2;
const BUILT_IN_CATEGORY_NAMES = new Set<string>(BUILT_IN_QUESTION_CATEGORIES);

export interface StructuredQaModelOptions {
  readonly maxOutputTokens?: number;
  readonly model: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly strictness?: ReviewStrictness;
  readonly timeoutMs?: number;
}

export interface ResolvedStructuredQaModelOptions {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly strictness: ReviewStrictness;
  readonly timeoutMs: number;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** 不正な値なら undefined を返し、どのプロバイダのエラーにするかは呼び出し側に任せる。 */
export function resolveStructuredQaModelOptions(
  options: StructuredQaModelOptions
): ResolvedStructuredQaModelOptions | undefined {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QA_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const model = options.model.trim();
  if (
    !isPositiveInteger(timeoutMs) ||
    !isPositiveInteger(maxOutputTokens) ||
    model.length === 0
  ) {
    return undefined;
  }
  return {
    maxOutputTokens,
    model,
    reasoningEffort: options.reasoningEffort ?? "low",
    strictness: options.strictness ?? DEFAULT_REVIEW_STRICTNESS,
    timeoutMs
  };
}

/**
 * 質問生成・回答判定・要約の検証はプロバイダに依らない。プロバイダの差は
 * StructuredOutputClient に閉じ込め、ここでは揃えた応答だけを扱う。
 */
export class StructuredQaModel implements QaModel {
  readonly #client: StructuredOutputClient;
  readonly #options: ResolvedStructuredQaModelOptions;

  constructor(
    client: StructuredOutputClient,
    options: ResolvedStructuredQaModelOptions
  ) {
    this.#client = client;
    this.#options = options;
  }

  async #parse<Schema extends z.ZodType>(
    schema: Schema,
    schemaName: string,
    prompt: ModelPrompt,
    signal?: AbortSignal
  ): Promise<z.output<Schema>> {
    let response: StructuredOutputResult<z.output<Schema>>;
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
      throw this.#client.classifyError(error);
    }

    if (response.incomplete) {
      throw this.#client.createError("incomplete");
    }
    if (response.failed) {
      throw this.#client.createError("response_failed");
    }
    if (response.refused) {
      throw this.#client.createError("refusal");
    }
    if (response.parsed === null) {
      throw this.#client.createError("missing_parsed_output");
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
      throw this.#client.createError("invalid_input");
    }

    const output = await this.#parse(
      questionListWireSchema,
      "sekisyo_questions",
      buildQuestionGenerationPrompt(input),
      signal
    );
    if (output.questions.length !== input.questionCount) {
      throw this.#client.createError("invalid_response");
    }

    const questions = output.questions.map(toQuestion);
    if (
      new Set(questions.map((question) => question.id)).size !==
      questions.length
    ) {
      throw this.#client.createError("invalid_response");
    }

    if (violatesCategoryPolicy(input, questions)) {
      throw this.#client.createError("invalid_response");
    }
    return questions;
  }

  async judgeAnswer(
    input: AnswerJudgmentInput,
    signal?: AbortSignal
  ): Promise<AnswerJudgment> {
    if (input.answer.trim().length === 0) {
      throw this.#client.createError("invalid_input");
    }

    const prompt = buildAnswerJudgmentPrompt(input, this.#options.strictness);
    for (
      let attempt = 0;
      attempt < MAX_ANSWER_JUDGMENT_ATTEMPTS;
      attempt += 1
    ) {
      const output = await this.#parse(
        answerJudgmentWireResponseSchema,
        "sekisyo_answer_judgment",
        prompt,
        signal
      );
      const correlated = answerJudgmentWireSchema.safeParse(output);
      if (correlated.success) {
        return toAnswerJudgment(correlated.data);
      }
    }

    throw this.#client.createError("invalid_response");
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

function violatesCategoryPolicy(
  input: QuestionGenerationInput,
  questions: readonly Question[]
): boolean {
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
  return (
    includesDisabledBuiltIn ||
    missesRequiredCategory ||
    generatedCustomCount < requiredCustomCount
  );
}
