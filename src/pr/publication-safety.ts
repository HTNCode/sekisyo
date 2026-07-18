import type { SekisyoPrBlock } from "./marker.ts";

const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:[a-z0-9]+[ _-])*(?:api[ _-]?key|access[ _-]?key|account[ _-]?key|client[ _-]?secret|private[ _-]?key|secret[ _-]?access[ _-]?key|connection[ _-]?string|sas[ _-]?token|secret|token|password|passwd|pwd)\b["'`]?\s*(?:=|:)\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([^\s,;]+))/giu;
const CREDENTIAL_URL_PATTERN = /\bhttps?:\/\/[^\s/:@]+:([^\s/@]+)@[^\s]+/giu;
const ENVIRONMENT_REFERENCE_PATTERN =
  /^(?:\$\{[a-z_][a-z0-9_]*\}|\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%|(?:process\.)?env\.[a-z_][a-z0-9_]*)$/iu;
const MASKED_VALUE_PATTERN = /^[*x]{3,}$/iu;
const SAFE_SECRET_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "absent",
  "api key",
  "api-key",
  "api_key",
  "available",
  "configured",
  "disabled",
  "dummy",
  "encrypted",
  "example",
  "example value",
  "example-value",
  "example_value",
  "expired",
  "false",
  "generated",
  "hashed",
  "hidden",
  "invalid",
  "masked",
  "missing",
  "n/a",
  "none",
  "not set",
  "not-set",
  "not_set",
  "null",
  "omitted",
  "optional",
  "password",
  "placeholder",
  "present",
  "protected",
  "redacted",
  "refreshed",
  "removed",
  "required",
  "rotated",
  "secret",
  "stored",
  "test",
  "test value",
  "test-value",
  "test_value",
  "token",
  "true",
  "unchanged",
  "unknown",
  "マスク済み",
  "不要",
  "伏せ字",
  "変更なし",
  "必要",
  "更新済み",
  "期限切れ",
  "未設定",
  "無効",
  "削除済み",
  "設定済み"
]);

interface SecretSignature {
  readonly name: string;
  readonly pattern: RegExp;
}

const SECRET_SIGNATURES: readonly SecretSignature[] = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u
  },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u
  },
  {
    name: "OpenAI API key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/u
  },
  {
    name: "Stripe secret key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/u
  },
  {
    name: "GitLab token",
    pattern: /\bglpat-[0-9A-Za-z_-]{20,}\b/u
  },
  {
    name: "npm token",
    pattern: /\bnpm_[0-9A-Za-z]{20,}\b/u
  },
  {
    name: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
  },
  {
    name: "bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}(?=\s|$)/iu
  },
  {
    name: "basic authorization",
    pattern: /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}(?=\s|$)/iu
  }
];

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127)
    ) {
      return true;
    }
  }
  return false;
}

function assignedSecretValue(match: RegExpMatchArray): string {
  return match.slice(1).find((value) => value !== undefined) ?? "";
}

function isSafePlaceholder(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/[.!?。]+$/u, "")
    .toLowerCase();
  const unwrapped =
    (normalized.startsWith("<") && normalized.endsWith(">")) ||
    (normalized.startsWith("[") && normalized.endsWith("]"))
      ? normalized.slice(1, -1).trim()
      : normalized;
  return (
    SAFE_SECRET_PLACEHOLDERS.has(unwrapped) ||
    MASKED_VALUE_PATTERN.test(unwrapped) ||
    ENVIRONMENT_REFERENCE_PATTERN.test(unwrapped)
  );
}

function secretKind(value: string): string | undefined {
  const normalized = value.normalize("NFKC");
  for (const signature of SECRET_SIGNATURES) {
    if (signature.pattern.test(normalized)) {
      return signature.name;
    }
  }

  for (const match of normalized.matchAll(CREDENTIAL_URL_PATTERN)) {
    const password = match[1];
    if (password !== undefined && !isSafePlaceholder(password)) {
      return "credential-bearing URL";
    }
  }

  for (const match of normalized.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const assignedValue = assignedSecretValue(match);
    if (assignedValue.length > 0 && !isSafePlaceholder(assignedValue)) {
      return "credential assignment";
    }
  }
  return undefined;
}

function assertSafePublicationField(fieldName: string, value: string): void {
  if (hasUnsafeControlCharacter(value)) {
    throw new Error(
      `PR公開対象の「${fieldName}」に安全でない制御文字を検出したため、公開を中止しました。`
    );
  }
  const detectedKind = secretKind(value);
  if (detectedKind !== undefined) {
    throw new Error(
      `PR公開対象の「${fieldName}」に秘密情報の可能性がある値（${detectedKind}）を検出したため、公開を中止しました。該当値を削除または明示的に伏せ字にしてから再実行してください。`
    );
  }
}

export function assertSafePublicationInput(input: SekisyoPrBlock): void {
  if (!GIT_OBJECT_ID_PATTERN.test(input.headOid)) {
    throw new Error("PR記録のHEAD OIDが正しいGit object IDではありません。");
  }

  if (input.intent !== undefined) {
    assertSafePublicationField("変更意図", input.intent);
  }
  input.attention.forEach((item, index) => {
    assertSafePublicationField(
      `注意力マップ[${index}].location`,
      item.location
    );
    assertSafePublicationField(`注意力マップ[${index}].reason`, item.reason);
  });
  input.reviewResolutions?.forEach((item, index) => {
    assertSafePublicationField(
      `一次セルフレビュー[${index}].finding`,
      item.finding
    );
    assertSafePublicationField(
      `一次セルフレビュー[${index}].location`,
      item.location
    );
    assertSafePublicationField(
      `一次セルフレビュー[${index}].reason`,
      item.reason
    );
  });
  input.decisions.forEach((item, index) => {
    assertSafePublicationField(`設計判断[${index}]`, item);
  });
  input.risks.forEach((item, index) => {
    assertSafePublicationField(`リスク[${index}]`, item);
  });
  input.verification.forEach((item, index) => {
    assertSafePublicationField(`検証[${index}]`, item);
  });
  input.unresolved?.forEach((item, index) => {
    assertSafePublicationField(`未解決・未確認[${index}]`, item);
  });
  input.evidence.forEach((item, index) => {
    assertSafePublicationField(`Q&A[${index}].category`, item.category);
    assertSafePublicationField(`Q&A[${index}].question`, item.question);
    assertSafePublicationField(`Q&A[${index}].answer`, item.answer);
  });
}
