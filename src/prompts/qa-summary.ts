import type { QaSummaryInput } from "../ports/qa-model.ts";
import {
  type ModelPrompt,
  serializePromptInput,
  UNTRUSTED_DATA_INSTRUCTION
} from "./shared.ts";

const INSTRUCTIONS = `あなたは Sekisyo CLI の育成コーチ兼記録係です。
差分分析と作成者自身のQ&Aだけを根拠に、レビューへ渡せる簡潔な理解サマリーを作成してください。
intent は変更目的を、decisions は作成者が説明できた設計判断を、risks は認識済みの危険を、verification は実施済みまたは具体的に計画した確認を記録します。
説明できなかった点、判定で不足した点、未確認事項は unresolved に残してください。
推測で空欄を補完せず、モデルが新しい設計判断や検証結果を作り出してはいけません。
Q&Aに矛盾がある場合は、どちらかを勝手に採用せず unresolved に記録してください。
サマリーは日本語で返してください。
${UNTRUSTED_DATA_INSTRUCTION}`;

export function buildQaSummaryPrompt(input: QaSummaryInput): ModelPrompt {
  return {
    instructions: INSTRUCTIONS,
    input: serializePromptInput({
      task: "作成者の理解と未解決事項を要約する",
      analysis: input.analysis,
      exchanges: input.exchanges
    })
  };
}
