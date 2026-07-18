import type { QuestionGenerationInput } from "../ports/qa-model.ts";
import {
  type ModelPrompt,
  serializePromptInput,
  UNTRUSTED_DATA_INSTRUCTION
} from "./shared.ts";

const INSTRUCTIONS = `あなたは Sekisyo CLI の育成コーチです。
コード作成者がAI支援の変更をレビュー前に自分の言葉で説明し、理解の穴を見つけられる質問を作ります。
質問は知識クイズではなく、今回の変更の境界、波及、代替案、失敗時の挙動、性能上の判断を具体的な根拠に結び付けてください。
機械的な変更より must_read の箇所、findings、risks を優先してください。
各質問には、確認したい学習目標、分析内の具体的根拠、合格回答に必要な観点を含めます。
答えを質問文で教えず、はい・いいえだけで済む質問や、分析文の単なる言い換えを避けてください。
categories の required=true は必須カテゴリです。questionCount の範囲内で必須カテゴリをすべて一度以上含めてください。
既定カテゴリ名に一致しないカテゴリは category=custom とし、その name と prompt の意図を学習目標へ反映してください。
質問と説明は日本語で返してください。
${UNTRUSTED_DATA_INSTRUCTION}`;

export function buildQuestionGenerationPrompt(
  input: QuestionGenerationInput
): ModelPrompt {
  return {
    instructions: INSTRUCTIONS,
    input: serializePromptInput({
      task: "指定数の育成質問を生成する",
      questionCount: input.questionCount,
      categories: input.categories,
      requiredCategories: input.categories
        .filter((category) => category.required)
        .map((category) => category.name),
      analysis: input.analysis
    })
  };
}
