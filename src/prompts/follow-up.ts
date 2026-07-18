import type { FollowUpGenerationInput } from "../ports/qa-model.ts";
import {
  type ModelPrompt,
  serializePromptInput,
  UNTRUSTED_DATA_INSTRUCTION
} from "./shared.ts";

const INSTRUCTIONS = `あなたは Sekisyo CLI の育成コーチです。
最初の質問と回答判定を踏まえ、作成者が不足している理解へ自力で到達するための追撃質問を一つだけ作ってください。
追撃は最初の質問を繰り返さず、missingConceptをコード上の根拠、因果関係、具体的な失敗例のいずれかに結び付けます。
模範解答を埋め込まず、責める表現や誘導的な二択を避けてください。
判定が合格で追撃が不要なら followUp を null にしてください。
質問と説明は日本語で返してください。
${UNTRUSTED_DATA_INSTRUCTION}`;

export function buildFollowUpPrompt(
  input: FollowUpGenerationInput
): ModelPrompt {
  return {
    instructions: INSTRUCTIONS,
    input: serializePromptInput({
      task: "理解の穴を一つに絞った追撃質問を生成する",
      originalQuestion: input.question,
      answer: input.answer,
      judgment: input.judgment
    })
  };
}
