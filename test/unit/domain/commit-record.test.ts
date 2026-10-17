import { describe, expect, test } from "bun:test";

import {
  commitRecordBinding,
  composePassedSession,
  COMMIT_RECORD_REMOTE
} from "../../../src/domain/commit-record.ts";
import { SessionRecordSchema } from "../../../src/domain/session.ts";
import { bindingFor, passedSession } from "../support/passed-session.ts";

const NOW = "2026-10-18T01:00:00.000Z";

describe("commitRecordBinding", () => {
  test("親とステージ済みツリーで束縛し、実在のremoteと衝突しない", () => {
    const binding = commitRecordBinding({
      parent: "1".repeat(40),
      tree: "3".repeat(40),
      policyDigest: "a".repeat(64),
      promptVersion: "v",
      model: "m"
    });
    expect(binding).toMatchObject({
      base: "1".repeat(40),
      head: "3".repeat(40),
      remote: COMMIT_RECORD_REMOTE,
      ref: `index@${"3".repeat(40)}`
    });
  });
});

describe("composePassedSession", () => {
  const sources = [
    { label: "abc1234", session: passedSession(bindingFor(), "first") },
    {
      label: "def5678",
      session: passedSession(bindingFor({ head: "4".repeat(40) }), "second")
    }
  ];

  test("記録ごとに接頭辞を付け、回答と判断の対応を保ったまま通過済みにする", () => {
    const composed = composePassedSession(
      bindingFor({ head: "9".repeat(40) }),
      sources,
      2,
      NOW
    );

    expect(composed?.status).toBe("passed");
    expect(() => SessionRecordSchema.parse(composed)).not.toThrow();
    expect(composed?.questions.map((question) => question.id)).toEqual([
      "s1-q1",
      "s2-q1"
    ]);
    expect(composed?.attempts.map((attempt) => attempt.questionId)).toEqual([
      "s1-q1",
      "s2-q1"
    ]);
    expect(composed?.analysis?.findings.map((finding) => finding.id)).toEqual([
      "s1-f1",
      "s2-f1"
    ]);
    expect(
      composed?.reviewResolutions.map((resolution) => resolution.findingId)
    ).toEqual(["s1-f1", "s2-f1"]);
    expect(composed?.analysis?.summary).toBe(
      "[abc1234] firstの変更\n[def5678] secondの変更"
    );
    expect(composed?.analysis?.filesChanged).toBe(2);
    expect(composed?.head).toBe("9".repeat(40));
  });

  test("未通過の記録が混ざっていればまとめない", () => {
    const pending = {
      label: "x",
      session: {
        ...passedSession(bindingFor(), "x"),
        status: "failed" as const
      }
    };
    expect(
      composePassedSession(bindingFor(), [...sources, pending], 1, NOW)
    ).toBeUndefined();
  });

  test("スキーマの上限を超えるならまとめない", () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      label: `c${index}`,
      session: passedSession(bindingFor(), `c${index}`)
    }));
    expect(composePassedSession(bindingFor(), many, 1, NOW)).toBeUndefined();
  });
});
