import { describe, expect, test } from "bun:test";
import { validateReviewReason } from "../../../src/application/review-reason.ts";

describe("validateReviewReason", () => {
  test.each([
    "問題ないです",
    "問　題・ないです！",
    "問 題 な し",
    "大丈夫です",
    "大丈夫です。問題ありません。",
    "仕様どおりだと思います",
    "仕様どおりです。リスクは許容します"
  ])("表記揺れを含む定型文を拒否する: %s", (reason) => {
    expect(validateReviewReason(reason)).toEqual({
      message:
        "定型的な回答では記録できません。" +
        "具体的な仕様・制約と、リスクをどう扱うかを入力してください。",
      valid: false
    });
  });

  test("仕様・制約が不足している観点を示す", () => {
    expect(validateReviewReason("競合リスクは直列化で回避します")).toEqual({
      message:
        "仕様・制約の具体化が不足しています。" +
        "対象条件、上限、呼び出し側の前提などを入力してください。",
      valid: false
    });
  });

  test("リスクの扱いが不足している観点を示す", () => {
    expect(validateReviewReason("API仕様では最大10件です")).toEqual({
      message:
        "リスクの扱いが不足しています。" +
        "想定リスクと、回避・軽減・監視・許容の方針を入力してください。",
      valid: false
    });
  });

  test("観点名だけを並べた理由を情報不足として拒否する", () => {
    expect(
      validateReviewReason("仕様と制約は確認済みで、リスクは許容します")
    ).toEqual({
      message:
        "仕様・制約とリスクの扱いが不足しています。" +
        "対象条件や前提と、想定リスクをどう回避・軽減・許容するかを具体的に入力してください。",
      valid: false
    });
  });

  test("ラベルに記号を足しただけの理由を情報不足として拒否する", () => {
    expect(validateReviewReason("仕様A、リスクBは許容します")).toEqual({
      message:
        "仕様・制約とリスクの扱いが不足しています。" +
        "対象条件や前提と、想定リスクをどう回避・軽減・許容するかを具体的に入力してください。",
      valid: false
    });
  });

  test.each([
    "とりあえずこのまま進めてください",
    "なんとなくこの実装にしました",
    "とりあえず…ok",
    "とりあえずこのまま進めてください ok",
    "なんとなく既存データを更新しました",
    "問題ないのでこのまま進めてください lgtm"
  ])("具体アンカーのない曖昧な理由を拒否する: %s", (reason) => {
    expect(validateReviewReason(reason)).toEqual({
      message:
        "仕様・制約とリスクの扱いが不足しています。" +
        "対象条件や前提と、想定リスクをどう回避・軽減・許容するかを具体的に入力してください。",
      valid: false
    });
  });

  test.each([
    "上限10件、超過時は400で拒否します",
    "呼び出し側で直列化し、競合リスクを回避します",
    "呼び出し元でロックを取得するため競合しません",
    "入力0件なら早期returnし、DB書き込みをしません"
  ])("短くても具体的な理由を受理する: %s", (reason) => {
    expect(validateReviewReason(reason)).toEqual({
      valid: true,
      value: reason
    });
  });
});
