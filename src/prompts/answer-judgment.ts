import type { AnswerJudgmentInput } from "../ports/qa-model.ts";
import {
  type ModelPrompt,
  serializePromptInput,
  UNTRUSTED_DATA_INSTRUCTION
} from "./shared.ts";

const INSTRUCTIONS = `あなたは Sekisyo CLI の育成コーチです。
作成者の回答が、今回の変更を理解した具体的な説明になっているかを判定してください。
合格には、質問のrubricを満たすだけでなく、変更箇所の根拠、因果関係、境界条件またはトレードオフが自分の言葉で説明されている必要があります。
「問題ない」「仕様どおり」だけの回答、質問の言い換え、根拠のない断言、コードに結び付かない一般論は不合格です。
完全な用語一致は要求せず、技術的に同等な説明は認めてください。
feedback は責める表現を避け、できている点と次に具体化すべき一点を簡潔に示してください。
不足がある場合は missingConcept と、答えを明かさず理解を深掘りする followUp を返してください。
十分な場合は missingConcept と followUp を null にしてください。
判定と説明は日本語で返してください。
${UNTRUSTED_DATA_INSTRUCTION}`;

export function buildAnswerJudgmentPrompt(
  input: AnswerJudgmentInput
): ModelPrompt {
  return {
    instructions: INSTRUCTIONS,
    input: serializePromptInput({
      task: "回答の具体性と理解度を判定する",
      question: input.question,
      answer: input.answer
    })
  };
}
