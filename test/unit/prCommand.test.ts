import { describe, expect, test } from "bun:test";
import { latestPublishableSession } from "../../src/commands/pr.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import {
  createSessionRecord,
  transitionSession,
  type SessionRecord
} from "../../src/domain/session.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const REMOTE_OID = "c".repeat(40);
const binding = {
  base: "a".repeat(40),
  diffDigest: fingerprint("diff"),
  head: "b".repeat(40),
  model: "gpt-5.6",
  policyDigest: fingerprint("policy"),
  promptVersion: "sekisyo-prompts-v2",
  ref: "refs/heads/feature",
  remote: "origin"
};

function summarizedSession(
  changes: Partial<{
    readonly base: string;
    readonly diffDigest: string;
    readonly head: string;
    readonly model: string;
    readonly policyDigest: string;
    readonly promptVersion: string;
    readonly ref: string;
    readonly remote: string;
  }> = {}
): SessionRecord {
  let session = createSessionRecord(
    {
      ...binding,
      ref: `${binding.ref}@${REMOTE_OID}`,
      ...changes
    },
    NOW
  );
  session = transitionSession(session, "analyzed", NOW, {
    analysis: {
      attention: [],
      filesChanged: 1,
      findings: [],
      risks: [],
      summary: "変更概要"
    }
  });
  session = transitionSession(session, "review_resolved", NOW);
  session = transitionSession(session, "questioning", NOW);
  session = transitionSession(session, "passed", NOW);
  return transitionSession(session, "summarized", NOW, {
    summary: {
      decisions: [],
      intent: "変更意図",
      risks: [],
      unresolved: [],
      verification: []
    }
  });
}

describe("PR publishable session selection", () => {
  test("remote OID suffixを除く全bindingとdiffが一致する記録だけを選ぶ", () => {
    const expected = summarizedSession();

    expect(latestPublishableSession([expected], binding)).toBe(expected);
  });

  test.each([
    { base: "d".repeat(40) },
    { diffDigest: fingerprint("different diff") },
    { head: "e".repeat(40) },
    { model: "different-model" },
    { policyDigest: fingerprint("different policy") },
    { promptVersion: "different-prompt" },
    { ref: `refs/heads/other@${REMOTE_OID}` },
    { remote: "upstream" }
  ])("staleなbindingを拒否する: %o", (changes) => {
    const stale = summarizedSession(changes);

    expect(latestPublishableSession([stale], binding)).toBeUndefined();
  });
});
