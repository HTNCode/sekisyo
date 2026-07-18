import type { DiffAnalysis } from "../domain/analysis.ts";
import type {
  AnswerJudgment,
  QaExchange,
  QaSummary,
  Question
} from "../domain/questions.ts";

export interface QuestionGenerationInput {
  readonly analysis: DiffAnalysis;
  readonly questionCount: number;
  readonly categories: readonly QuestionCategoryRequest[];
}

export interface QuestionCategoryRequest {
  readonly name: string;
  readonly required: boolean;
  readonly prompt?: string;
}

export interface AnswerJudgmentInput {
  readonly question: Question;
  readonly answer: string;
}

export interface QaSummaryInput {
  readonly analysis: DiffAnalysis;
  readonly exchanges: readonly QaExchange[];
}

export interface QaModel {
  generateQuestions(
    input: QuestionGenerationInput,
    signal?: AbortSignal
  ): Promise<readonly Question[]>;
  judgeAnswer(
    input: AnswerJudgmentInput,
    signal?: AbortSignal
  ): Promise<AnswerJudgment>;
  summarize(input: QaSummaryInput, signal?: AbortSignal): Promise<QaSummary>;
}
