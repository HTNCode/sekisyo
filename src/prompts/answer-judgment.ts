import {
  DEFAULT_REVIEW_STRICTNESS,
  REVIEW_STRICTNESS_LEVELS,
  type ReviewStrictness
} from "../domain/strictness.ts";
import type { AnswerJudgmentInput } from "../ports/qa-model.ts";
import {
  type ModelPrompt,
  serializePromptInput,
  UNTRUSTED_DATA_INSTRUCTION
} from "./shared.ts";

const STRICTNESS_CRITERIA: Record<ReviewStrictness, string> = {
  light:
    "初級レベルの実戦経験を求めるような強度です。" +
    "合格には、変更の目的と変更箇所の因果関係が自分の言葉で説明されている必要があります。" +
    "境界条件やトレードオフの網羅は要求せず、説明の方向性が正しく最低限の具体性があれば合格にしてください。" +
    "コードの行や識別子への直接の言及がなくても、変更の目的・用途・運用上の前提が指摘内容と矛盾せず、" +
    "判断の理由が読み取れる説明は合格にしてください。rubricは参考観点として扱い、全項目の充足を要求しないでください。",
  standard:
    "中級レベルの実戦経験を求めるような強度です。" +
    "合格には、質問のrubricを満たすだけでなく、変更箇所の根拠、因果関係、境界条件またはトレードオフが自分の言葉で説明されている必要があります。" +
    "コードに結び付かない一般論は不合格です。",
  strict:
    "上級レベルの実戦経験を求めるような強度です。" +
    "合格には、質問のrubricをすべて満たし、変更箇所の根拠、因果関係、境界条件とトレードオフの両方、" +
    "さらに動作確認・検証の方法までが自分の言葉で説明されている必要があります。曖昧さが残る回答は不合格にしてください。" +
    "コードに結び付かない一般論は不合格です。"
};

function buildInstructions(strictness: ReviewStrictness): string {
  const criteriaOverview = REVIEW_STRICTNESS_LEVELS.map(
    (level) =>
      `- ${level}${level === strictness ? "（今回の設定）" : ""}: ${STRICTNESS_CRITERIA[level]}`
  ).join("\n");
  return `あなたは Sekisyo CLI の育成コーチです。
作成者の回答が、今回の変更を理解した具体的な説明になっているかを判定してください。
今回のレビュー強度は${strictness}です。強度は3段階あり、相対的な位置づけは次のとおりです。
${criteriaOverview}
今回の設定である${strictness}の基準だけを適用し、他の強度の要求水準を持ち込まないでください。
以降の共通ルールが${strictness}の基準と矛盾する場合は、${strictness}の基準を優先してください。
「問題ない」「仕様どおり」のみの回答、質問の言い換え、根拠のない断言は不合格です。
完全な用語一致は要求せず、技術的に同等な説明は認めてください。
feedback は責める表現を避け、できている点と次に具体化すべき一点を簡潔に示してください。
不合格の場合は missingConcept と、答えを明かさず理解を深掘りする followUp を必ず返してください。
合格の場合は missingConcept と followUp を必ず null にしてください。
判定と説明はユーザーが扱っている言語で返してください。
${UNTRUSTED_DATA_INSTRUCTION}`;
}

export function buildAnswerJudgmentPrompt(
  input: AnswerJudgmentInput,
  strictness: ReviewStrictness = DEFAULT_REVIEW_STRICTNESS
): ModelPrompt {
  return {
    instructions: buildInstructions(strictness),
    input: serializePromptInput({
      task: "回答の具体性と理解度を判定する",
      question: input.question,
      answer: input.answer
    })
  };
}
