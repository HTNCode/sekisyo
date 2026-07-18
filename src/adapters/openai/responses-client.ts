import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseStatus } from "openai/resources/responses/responses";
import type { z } from "zod";

import type { ModelPrompt } from "../../prompts/shared.ts";

export type OpenAIReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredResponseRequest<Schema extends z.ZodType> {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly prompt: ModelPrompt;
  readonly reasoningEffort: OpenAIReasoningEffort;
  readonly schema: Schema;
  readonly schemaName: string;
  readonly timeoutMs: number;
}

export interface StructuredResponse<Output> {
  readonly failed: boolean;
  readonly incompleteReason: "content_filter" | "max_output_tokens" | null;
  readonly parsed: Output | null;
  readonly refused: boolean;
  readonly status: ResponseStatus | undefined;
}

export interface OpenAIResponsesClient {
  parse<Schema extends z.ZodType>(
    request: StructuredResponseRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredResponse<z.output<Schema>>>;
}

function containsRefusal(
  output: Awaited<ReturnType<OpenAI["responses"]["parse"]>>["output"]
): boolean {
  return output.some(
    (item) =>
      item.type === "message" &&
      item.content.some((content) => content.type === "refusal")
  );
}

export class OpenAISdkResponsesClient implements OpenAIResponsesClient {
  readonly #client: OpenAI;

  constructor(client: OpenAI) {
    this.#client = client;
  }

  async parse<Schema extends z.ZodType>(
    request: StructuredResponseRequest<Schema>,
    signal?: AbortSignal
  ): Promise<StructuredResponse<z.output<Schema>>> {
    const response = await this.#client.responses.parse(
      {
        model: request.model,
        instructions: request.prompt.instructions,
        input: request.prompt.input,
        max_output_tokens: request.maxOutputTokens,
        reasoning: { effort: request.reasoningEffort },
        store: false,
        text: {
          format: zodTextFormat(request.schema, request.schemaName)
        }
      },
      {
        signal,
        timeout: request.timeoutMs
      }
    );

    return {
      failed: response.error !== null || response.status === "failed",
      incompleteReason: response.incomplete_details?.reason ?? null,
      parsed: response.output_parsed,
      refused: containsRefusal(response.output),
      status: response.status
    };
  }
}
