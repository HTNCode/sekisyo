import { assertSafePublicationInput } from "./publication-safety.ts";

export const PR_BLOCK_START = "<!-- sekisyo:start:v1 -->";
export const PR_BLOCK_END = "<!-- sekisyo:end -->";

const RESERVED_HEAD_LABEL = "**対象HEAD:**";

export interface PrAttentionItem {
  readonly classification: "mechanical" | "routine" | "must_read";
  readonly endLine?: number;
  readonly location: string;
  readonly reason: string;
  readonly startLine?: number;
}

export interface PrEvidence {
  readonly answer: string;
  readonly category: string;
  readonly question: string;
}

export interface PrReviewResolution {
  readonly finding: string;
  readonly location: string;
  readonly reason: string;
}

export interface SekisyoPrBlock {
  readonly attention: readonly PrAttentionItem[];
  readonly decisions: readonly string[];
  readonly evidence: readonly PrEvidence[];
  readonly headOid: string;
  readonly intent?: string;
  readonly reviewResolutions?: readonly PrReviewResolution[];
  readonly risks: readonly string[];
  readonly unresolved?: readonly string[];
  readonly verification: readonly string[];
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function isStandaloneMarkerAt(
  value: string,
  marker: string,
  index: number
): boolean {
  const lineStartsAtMarker = index === 0 || value[index - 1] === "\n";
  const suffixIndex = index + marker.length;
  const suffix = value.slice(suffixIndex, suffixIndex + 2);
  const lineEndsAtMarker =
    suffixIndex === value.length ||
    suffix.startsWith("\n") ||
    suffix.startsWith("\r\n");
  return lineStartsAtMarker && lineEndsAtMarker;
}

function markdownList(items: readonly string[], emptyText: string): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${safeMarkdown(item)}`).join("\n");
}

function safeMarkdown(value: string): string {
  return value
    .replaceAll("\r", "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replaceAll(RESERVED_HEAD_LABEL, "\\*\\*対象HEAD:\\*\\*");
}

function knownLineCount(items: readonly PrAttentionItem[]): number {
  return items.reduce((total, item) => {
    if (item.startLine === undefined) {
      return total;
    }
    const endLine = item.endLine ?? item.startLine;
    return endLine >= item.startLine
      ? total + endLine - item.startLine + 1
      : total;
  }, 0);
}

function attentionSummary(
  label: string,
  items: readonly PrAttentionItem[]
): string {
  const lines = knownLineCount(items);
  const lineSummary = lines === 0 ? "行範囲不明" : `行範囲が判明: ${lines}行`;
  return `- ${label}: ${items.length}箇所（${lineSummary}）`;
}

export function renderSekisyoPrBlock(input: SekisyoPrBlock): string {
  assertSafePublicationInput(input);

  const mustRead = input.attention.filter(
    (item) => item.classification === "must_read"
  );
  const mechanical = input.attention.filter(
    (item) => item.classification === "mechanical"
  );
  const routine = input.attention.filter(
    (item) => item.classification === "routine"
  );

  const attentionLines = mustRead.map(
    (item) => `${item.location} — ${item.reason}`
  );
  const qaLines = input.evidence.map(
    (item) => `**${item.category}** — ${item.question}\n\n  ${item.answer}`
  );
  const resolutionLines = (input.reviewResolutions ?? []).map(
    (item) => `${item.location} — ${item.finding}: ${item.reason}`
  );

  return `${PR_BLOCK_START}
## Sekisyo 通過記録

**対象HEAD:** \`${input.headOid}\`

### 変更意図

${safeMarkdown(input.intent ?? "記録なし")}

### 注意力マップ

${attentionSummary("機械的変更", mechanical)}
${attentionSummary("定型変更", routine)}
${attentionSummary("必読", mustRead)}

${markdownList(attentionLines, "必読箇所なし")}

### 一次セルフレビューで意図的と判断した点

${markdownList(resolutionLines, "該当なし")}

### 設計判断

${markdownList(input.decisions, "記録なし")}

### リスク

${markdownList(input.risks, "記録なし")}

### 検証

${markdownList(input.verification, "記録なし")}

### 未解決・未確認

${markdownList(input.unresolved ?? [], "なし")}

### 作成者Q&A

${markdownList(qaLines, "記録なし")}

> SekisyoはAI利用を禁止しません。説明のないコードをレビューへ渡さないための記録です。
${PR_BLOCK_END}`;
}

export function upsertSekisyoBlock(
  existingBody: string,
  renderedBlock: string
): string {
  const startCount = countOccurrences(existingBody, PR_BLOCK_START);
  const endCount = countOccurrences(existingBody, PR_BLOCK_END);

  if (startCount !== endCount || startCount > 1) {
    throw new Error("PR body contains a malformed Sekisyo marker block.");
  }

  if (startCount === 0) {
    const prefix = existingBody.trimEnd();
    return prefix.length === 0
      ? `${renderedBlock}\n`
      : `${prefix}\n\n${renderedBlock}\n`;
  }

  const startIndex = existingBody.indexOf(PR_BLOCK_START);
  const endIndex = existingBody.indexOf(PR_BLOCK_END, startIndex);
  if (
    endIndex < startIndex ||
    !isStandaloneMarkerAt(existingBody, PR_BLOCK_START, startIndex) ||
    !isStandaloneMarkerAt(existingBody, PR_BLOCK_END, endIndex)
  ) {
    throw new Error("PR body contains a malformed Sekisyo marker block.");
  }
  const suffixIndex = endIndex + PR_BLOCK_END.length;
  return `${existingBody.slice(0, startIndex)}${renderedBlock}${existingBody.slice(suffixIndex)}`;
}
