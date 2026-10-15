import { describe, expect, test } from "bun:test";
import {
  ensurePublishableSessionSummary,
  latestPublishableSession
} from "../../src/commands/pr.ts";
import { PROMPT_VERSION } from "../../src/application/gate.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import type { QaSummary } from "../../src/domain/questions.ts";
import {
  createSessionRecord,
  transitionSession,
  type SessionRecord
} from "../../src/domain/session.ts";
import type { QaModel, SessionStore } from "../../src/ports/index.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const REMOTE_OID = "c".repeat(40);
const binding = {
  base: "a".repeat(40),
  diffDigest: fingerprint("diff"),
  head: "b".repeat(40),
  model: "gpt-5.6",
  policyDigest: fingerprint("policy"),
  promptVersion: PROMPT_VERSION,
  ref: "refs/heads/feature",
  remote: "origin"
};

function passedSession(
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
  return transitionSession(session, "passed", NOW);
}

function summarizedSession(
  changes: Parameters<typeof passedSession>[0] = {}
): SessionRecord {
  return transitionSession(passedSession(changes), "summarized", NOW, {
    summary: {
      decisions: [],
      intent: "変更意図",
      risks: [],
      unresolved: [],
      verification: []
    }
  });
}

class MemorySessionStore implements SessionStore {
  saved: SessionRecord | undefined;

  public async list(): Promise<readonly SessionRecord[]> {
    return this.saved === undefined ? [] : [this.saved];
  }

  public async load(_fingerprint: string): Promise<SessionRecord | null> {
    return this.saved ?? null;
  }

  public async remove(_fingerprint: string): Promise<void> {}

  public async save(session: SessionRecord): Promise<void> {
    this.saved = session;
  }
}

function modelWithSummary(): QaModel {
  return {
    generateQuestions: async () => [],
    judgeAnswer: async () => ({ feedback: "ok", passed: true }),
    summarize: async () => ({
      decisions: ["PR時に要約"],
      intent: "変更意図",
      risks: [],
      unresolved: [],
      verification: []
    })
  };
}

describe("PR publishable session selection", () => {
  test("remote OID suffixを除く全bindingとdiffが一致する記録だけを選ぶ", () => {
    const expected = summarizedSession();

    expect(latestPublishableSession([expected], binding)).toBe(expected);
  });

  test("要約前のpassed記録もpublish対象として選ぶ", () => {
    const expected = passedSession();

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

  test("passed記録はPR作成時にだけ要約してsummarizedで保存する", async () => {
    const store = new MemorySessionStore();
    let modelFactoryCalls = 0;
    let summarizeCalls = 0;

    const summarized = await ensurePublishableSessionSummary(
      passedSession(),
      store,
      () => {
        modelFactoryCalls += 1;
        const model = modelWithSummary();
        return {
          ...model,
          async summarize(input) {
            summarizeCalls += 1;
            return model.summarize(input);
          }
        };
      }
    );

    expect(modelFactoryCalls).toBe(1);
    expect(summarizeCalls).toBe(1);
    expect(summarized.status).toBe("summarized");
    expect(summarized.summary?.decisions).toEqual(["PR時に要約"]);
    expect(store.saved).toBe(summarized);
  });

  test("公開安全性検査に失敗した要約は保存せず、次回PR実行で再要約できる", async () => {
    const passed = passedSession();
    const store = new MemorySessionStore();
    store.saved = passed;
    const summaries: QaSummary[] = [
      {
        decisions: [],
        intent: `token = ${"A".repeat(32)}`,
        risks: [],
        unresolved: [],
        verification: []
      },
      {
        decisions: ["秘密情報をPRへ含めない"],
        intent: "安全な変更意図",
        risks: [],
        unresolved: [],
        verification: []
      }
    ];
    let modelFactoryCalls = 0;
    let summarizeCalls = 0;
    const createModel = (): QaModel => {
      modelFactoryCalls += 1;
      return {
        ...modelWithSummary(),
        async summarize() {
          summarizeCalls += 1;
          const next = summaries.shift();
          if (next === undefined) {
            throw new Error("No scripted summary remains.");
          }
          return next;
        }
      };
    };

    await expect(
      ensurePublishableSessionSummary(passed, store, createModel)
    ).rejects.toThrow("秘密情報の可能性がある値");

    expect(store.saved).toBe(passed);
    expect(store.saved.status).toBe("passed");
    expect(store.saved.summary).toBeNull();

    const retrySession = await store.load(passed.fingerprint);
    if (retrySession === null) {
      throw new Error("Expected the passed session to remain retryable.");
    }
    const recovered = await ensurePublishableSessionSummary(
      retrySession,
      store,
      createModel
    );

    expect(modelFactoryCalls).toBe(2);
    expect(summarizeCalls).toBe(2);
    expect(recovered.status).toBe("summarized");
    expect(recovered.summary?.intent).toBe("安全な変更意図");
    expect(store.saved).toBe(recovered);
  });

  test("既にsummarizedの記録ではmodelを生成せずそのまま再利用する", async () => {
    const existing = summarizedSession();
    const store = new MemorySessionStore();
    let modelFactoryCalls = 0;

    const result = await ensurePublishableSessionSummary(
      existing,
      store,
      () => {
        modelFactoryCalls += 1;
        return modelWithSummary();
      }
    );

    expect(result).toBe(existing);
    expect(modelFactoryCalls).toBe(0);
    expect(store.saved).toBeUndefined();
  });
});
