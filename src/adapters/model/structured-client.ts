import type { z } from "zod";

import type { ModelPrompt } from "../../prompts/shared.ts";
import type { ModelAdapterError, ModelAdapterErrorCode } from "./errors.ts";

// 送る側の値。各プロバイダが受け付けない段階は、各クライアントが近い値へ丸める。
export type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredOutputRequest<Schema extends z.ZodType> {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly prompt: ModelPrompt;
  readonly reasoningEffort: ReasoningEffort;
  readonly schema: Schema;
  readonly schemaName: string;
  readonly timeoutMs: number;
}

/** プロバイダごとの応答を、Q&A の検証に必要な状態だけへ揃えたもの。 */
export interface StructuredOutputResult<Output> {
  readonly failed: boolean;
  readonly incomplete: boolean;
  readonly parsed: Output | null;
  readonly refused: boolean;
}

export interface StructuredOutputClient {
  parse<Schema extends z.ZodType>(
    request: StructuredOutputRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredOutputResult<z.output<Schema>>>;
  /** SDK が投げた例外を、利用者に見せてよい分類へ変換する。 */
  classifyError(error: unknown): ModelAdapterError;
  createError(code: ModelAdapterErrorCode): ModelAdapterError;
}
