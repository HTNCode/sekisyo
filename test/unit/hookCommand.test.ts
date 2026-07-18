import { describe, expect, test } from "bun:test";

import type {
  GateDependencies,
  GateTarget
} from "../../src/application/gate.ts";
import { PROMPT_VERSION } from "../../src/application/gate.ts";
import { DEFAULT_CONFIG, createPolicyDigest } from "../../src/config/index.ts";
import { runPrePushHook } from "../../src/commands/hook.ts";
import {
  createGateDependencies,
  type PreparedGateContext
} from "../../src/commands/runtime.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import {
  createSessionRecord,
  transitionSession,
  type SessionRecord
} from "../../src/domain/session.ts";
import type {
  DiffAnalyzer,
  QaModel,
  SessionStore,
  Terminal
} from "../../src/ports/index.ts";

const BASE_OID = "a".repeat(40);
const HEAD_OID = "b".repeat(40);
const ZERO_OID = "0".repeat(40);
const NOW = "2026-07-19T00:00:00.000Z";
const DIFF = "diff --git a/file.ts b/file.ts\n";

class MemorySessionStore implements SessionStore {
  loadCalls = 0;

  public constructor(private readonly session: SessionRecord | null) {}

  public async list(): Promise<readonly SessionRecord[]> {
    return this.session === null ? [] : [this.session];
  }

  public async load(_fingerprint: string): Promise<SessionRecord | null> {
    this.loadCalls += 1;
    return this.session;
  }

  public async remove(_fingerprint: string): Promise<void> {}

  public async save(_session: SessionRecord): Promise<void> {}
}

class FakeTerminal implements Terminal {
  closed = false;

  public close(): void {
    this.closed = true;
  }

  public async confirm(_message: string): Promise<boolean> {
    return true;
  }

  public error(_message: string): void {}

  public async prompt(_message: string): Promise<string> {
    return "answer";
  }

  public async select<Value extends string>(
    _message: string,
    options: readonly { readonly value: Value }[]
  ): Promise<Value> {
    const first = options[0];
    if (first === undefined) {
      throw new Error("A test selection requires an option.");
    }
    return first.value;
  }

  public write(_message: string): void {}
}

function target(): GateTarget {
  return {
    analysisTarget: { kind: "base", baseRef: BASE_OID },
    base: BASE_OID,
    changedFiles: ["file.ts"],
    diff: DIFF,
    diffDigest: fingerprint(DIFF),
    head: HEAD_OID,
    policyDigest: createPolicyDigest(DEFAULT_CONFIG),
    ref: `refs/heads/feature@${ZERO_OID}`,
    remote: "origin",
    repoRoot: "C:\\repo"
  };
}

function passedSession(gateTarget: GateTarget): SessionRecord {
  let session = createSessionRecord(
    {
      base: gateTarget.base,
      diffDigest: gateTarget.diffDigest,
      head: gateTarget.head,
      model: DEFAULT_CONFIG.model,
      policyDigest: gateTarget.policyDigest,
      promptVersion: PROMPT_VERSION,
      ref: gateTarget.ref,
      remote: gateTarget.remote
    },
    NOW
  );
  session = transitionSession(session, "analyzed", NOW, {
    analysis: {
      attention: [],
      filesChanged: 1,
      findings: [],
      risks: [],
      summary: "summary"
    }
  });
  session = transitionSession(session, "review_resolved", NOW);
  session = transitionSession(session, "questioning", NOW);
  return transitionSession(session, "passed", NOW);
}

function context(store: SessionStore): PreparedGateContext {
  return {
    config: DEFAULT_CONFIG,
    store,
    target: target()
  };
}

const analyzer: DiffAnalyzer = {
  analyze: async () => ({
    attention: [],
    filesChanged: 1,
    findings: [],
    risks: [],
    summary: "summary"
  })
};
const model: QaModel = {
  generateQuestions: async () => [],
  judgeAnswer: async () => ({ feedback: "ok", passed: true }),
  summarize: async () => ({
    decisions: [],
    intent: "intent",
    risks: [],
    unresolved: [],
    verification: []
  })
};

describe("runPrePushHook", () => {
  test("cache hitではanalyzer/model factoryと端末を生成しない", async () => {
    const gateTarget = target();
    const store = new MemorySessionStore(passedSession(gateTarget));
    const prepared = context(store);
    let analyzerFactoryCalls = 0;
    let modelFactoryCalls = 0;
    let terminalFactoryCalls = 0;
    let gateCalls = 0;

    const result = await runPrePushHook(
      {
        cwd: "C:\\repo",
        remote: "origin",
        stdin: `refs/heads/feature ${HEAD_OID} refs/heads/feature ${ZERO_OID}\n`
      },
      {
        createDependencies: (gateContext, terminal) =>
          createGateDependencies(gateContext, terminal, {
            createAnalyzer: () => {
              analyzerFactoryCalls += 1;
              return analyzer;
            },
            createModel: () => {
              modelFactoryCalls += 1;
              return model;
            }
          }),
        createTerminal: () => {
          terminalFactoryCalls += 1;
          return new FakeTerminal();
        },
        prepareContext: async () => prepared,
        resolveCommit: async () => HEAD_OID,
        runGate: async () => {
          gateCalls += 1;
          return passedSession(gateTarget);
        }
      }
    );

    expect(result).toBe(0);
    expect(analyzerFactoryCalls).toBe(0);
    expect(modelFactoryCalls).toBe(0);
    expect(terminalFactoryCalls).toBe(0);
    expect(gateCalls).toBe(0);
    expect(store.loadCalls).toBe(1);
  });

  test("cache missではstore再読込なしでgateを一度だけ実行する", async () => {
    const gateTarget = target();
    const store = new MemorySessionStore(null);
    const prepared = context(store);
    const terminal = new FakeTerminal();
    let receivedOptions: { readonly allowReuse?: boolean } | undefined;
    let dependencies: GateDependencies | undefined;

    const result = await runPrePushHook(
      {
        cwd: "C:\\repo",
        remote: "origin",
        stdin: `refs/heads/feature ${HEAD_OID} refs/heads/feature ${ZERO_OID}\n`
      },
      {
        createDependencies: (gateContext, gateTerminal) =>
          createGateDependencies(gateContext, gateTerminal, {
            createAnalyzer: () => analyzer,
            createModel: () => model
          }),
        createTerminal: () => terminal,
        prepareContext: async () => prepared,
        resolveCommit: async () => HEAD_OID,
        runGate: async (gateDependencies, _config, _target, options) => {
          dependencies = gateDependencies;
          receivedOptions = options;
          return passedSession(gateTarget);
        }
      }
    );

    expect(result).toBe(0);
    expect(dependencies?.store).toBe(prepared.store);
    expect(receivedOptions).toEqual({ allowReuse: false });
    expect(store.loadCalls).toBe(1);
    expect(terminal.closed).toBeTrue();
  });
});
