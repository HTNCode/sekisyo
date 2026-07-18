import { describe, expect, test } from "bun:test";
import { fingerprint } from "../../../src/domain/fingerprint.ts";
import {
  assessSessionFreshness,
  canTransitionSession,
  createSessionRecord,
  isTerminalSessionStatus,
  SessionRecordSchema,
  transitionSession
} from "../../../src/domain/session.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const ANALYSIS = {
  summary: "Summary",
  filesChanged: 1,
  attention: [],
  findings: [],
  risks: []
};

function createRecord() {
  return createSessionRecord(
    {
      base: "base",
      head: "head",
      remote: "origin",
      ref: "refs/heads/main",
      diffDigest: fingerprint("diff"),
      policyDigest: fingerprint("policy"),
      promptVersion: "v1",
      model: "gpt-5.6-sol"
    },
    NOW
  );
}

describe("session transitions", () => {
  test("承認済みの順序でpublishedまで遷移する", () => {
    const statuses = [
      "analyzed",
      "review_resolved",
      "questioning",
      "passed",
      "summarized",
      "published"
    ] as const;
    const analyzed = transitionSession(createRecord(), "analyzed", NOW, {
      analysis: ANALYSIS
    });
    const result = statuses
      .slice(1)
      .reduce(
        (session, status) => transitionSession(session, status, NOW),
        analyzed
      );
    expect(result.status).toBe("published");
    expect(isTerminalSessionStatus(result.status)).toBe(true);
  });

  test("順序を飛ばす遷移を拒否する", () => {
    expect(canTransitionSession("initialized", "questioning")).toBe(false);
    expect(() => transitionSession(createRecord(), "questioning", NOW)).toThrow(
      "Invalid session transition"
    );
  });

  test("非terminal状態からfailedへ遷移できる", () => {
    const failed = transitionSession(createRecord(), "failed", NOW);
    expect(failed.status).toBe("failed");
    expect(isTerminalSessionStatus(failed.status)).toBe(true);
    expect(canTransitionSession("failed", "initialized")).toBe(false);
  });

  test("bindingが変わったセッションをstaleと判定する", () => {
    const session = createRecord();
    expect(assessSessionFreshness(session, session)).toBe("current");
    expect(
      assessSessionFreshness(session, {
        ...session,
        head: "new-head"
      })
    ).toBe("stale");
  });

  test("fingerprint不一致と未定義フィールドを拒否する", () => {
    const session = createRecord();
    expect(() =>
      SessionRecordSchema.parse({
        ...session,
        fingerprint: fingerprint("wrong")
      })
    ).toThrow();
    expect(() =>
      SessionRecordSchema.parse({
        ...session,
        apiKey: "must-not-be-stored"
      })
    ).toThrow();
  });
});
