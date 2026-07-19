const CANNED_REASON_PATTERN =
  /^(?:(?:特に)?問題(?:は)?(?:ない|無い|なし|無し|ありません|ございません)(?:です)?(?:と思います)?|大丈夫(?:です|だ)?(?:と思います)?|仕様(?:どおり|通り)(?:です|だ)?(?:と思います)?|想定(?:どおり|通り)(?:です|だ)?(?:と思います)?|意図的(?:な変更)?(?:です)?|対応不要(?:です)?|影響(?:は)?(?:ない|無い|ありません)(?:です)?|許容範囲(?:です)?|リスク(?:は)?(?:許容|受け入れ)(?:します|です)?)+$/u;

const VAGUE_PATTERN =
  /とりあえず|なんとなく|分からない|分かりません|わからない|わかりません|説明できない|説明できません|理由はない|理由はありません|(?:この|その)まま(?:進め|許容)/iu;

const AUTHORITY_ONLY_PATTERN =
  /^(?:(?:私は|自分は|当方は)[^。]{0,30}(?:責任者|管理者|オーナー|owner)|(?:責任者|管理者|オーナー|owner)として)[^。]{0,20}(?:です|なので|だから)?[。.]?$/iu;

const GENERIC_TERMS_PATTERN =
  /仕様|要件|制約|前提|契約|条件|リスク|危険|影響|問題|意図的|変更|挙動|理由|扱い|対応|方針|確認済み|許容|受け入れ|問題ない|大丈夫|ありません|ございません|しています|します|です|ます|する|あり|なし|ない/giu;

const MIN_INFORMATIVE_CHARACTERS = 8;
const MAX_FIELD_CHARACTERS = 6_000;

export type ReviewReasonField = "scope" | "outcome" | "handling";

export interface ReviewReasonParts {
  readonly handling: string;
  readonly outcome: string;
  readonly scope: string;
}

export type ReviewReasonValidation =
  | {
      readonly valid: true;
      readonly value: string;
    }
  | {
      readonly message: string;
      readonly valid: false;
    };

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function compact(value: string): string {
  return normalize(value).replace(/[\s\p{C}\p{P}\p{S}]/gu, "");
}

function isCannedReason(value: string): boolean {
  const withoutConnectors = compact(value).replace(
    /(?:なので|ですので|ので|から|また|かつ|および|そして)/gu,
    ""
  );
  return CANNED_REASON_PATTERN.test(withoutConnectors);
}

function informativeCharacterCount(value: string): number {
  const remainder = compact(value)
    .replace(GENERIC_TERMS_PATTERN, "")
    .replace(/[はがをにでとのもへや]/gu, "");
  return [...new Set(remainder)].length;
}

function fieldLabel(field: ReviewReasonField): string {
  switch (field) {
    case "scope":
      return "適用範囲・仕様";
    case "outcome":
      return "結果・影響";
    case "handling":
      return "対応・判断";
  }
}

function fieldGuidance(field: ReviewReasonField): string {
  switch (field) {
    case "scope":
      return "この挙動を意図した対象、条件、制約を具体的に入力してください。";
    case "outcome":
      return "その条件で何が起きるか、利用者や後続処理への影響を入力してください。";
    case "handling":
      return "回避・軽減・検証・限定、または根拠を伴う許容判断を入力してください。";
  }
}

export function validateReviewReasonField(
  field: ReviewReasonField,
  reason: string
): ReviewReasonValidation {
  const value = reason.trim();
  if (value.length > MAX_FIELD_CHARACTERS) {
    return {
      message: `${fieldLabel(field)}は${MAX_FIELD_CHARACTERS.toLocaleString("ja-JP")}文字以内で入力してください。`,
      valid: false
    };
  }
  if (
    value.length === 0 ||
    isCannedReason(value) ||
    VAGUE_PATTERN.test(value) ||
    (field === "scope" && AUTHORITY_ONLY_PATTERN.test(value)) ||
    informativeCharacterCount(value) < MIN_INFORMATIVE_CHARACTERS
  ) {
    return {
      message: `${fieldLabel(field)}が具体的ではありません。${fieldGuidance(field)}`,
      valid: false
    };
  }
  return { valid: true, value };
}

export function formatReviewReason(parts: ReviewReasonParts): string {
  return [
    `適用範囲・仕様: ${parts.scope}`,
    `結果・影響: ${parts.outcome}`,
    `対応・判断: ${parts.handling}`
  ].join("\n");
}
