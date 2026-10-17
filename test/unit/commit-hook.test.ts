import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { GateTarget } from "../../src/application/gate.ts";
import {
  AGENT_SKIP_MESSAGE,
  isAgentEnvironment,
  runPreCommitHook,
  type PreCommitHookRuntime,
  type StagedChanges
} from "../../src/commands/commit-hook.ts";
import { parseConfig, type SekisyoConfig } from "../../src/config/index.ts";
import { COMMIT_RECORD_REMOTE } from "../../src/domain/commit-record.ts";
import type { SessionRecord } from "../../src/domain/session.ts";
import type {
  DiffAnalyzer,
  QaModel,
  SessionStore,
  Terminal
} from "../../src/ports/index.ts";
import { bindingFor, passedSession } from "./support/passed-session.ts";

const PARENT = "1".repeat(40);
const TREE = "3".repeat(40);
const HUMAN = {};

const enabled = parseConfig({ triggers: { commit: true } });

const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) {
    restore();
  }
});

function captureStderr(): string[] {
  const lines: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((line) => {
    lines.push(String(line));
  });
  restores.push(() => spy.mockRestore());
  return lines;
}

function notUsed(): never {
  throw new Error("not used");
}

/** 試問自体は runGate の差し替えで行わないため、入力系は呼ばれない。 */
class FakeTerminal implements Terminal {
  constructor(private readonly onClose: () => void) {}
  write(): void {}
  error(): void {}
  async prompt(): Promise<string> {
    return notUsed();
  }
  async confirm(): Promise<boolean> {
    return notUsed();
  }
  async select<Value extends string>(): Promise<Value> {
    return notUsed();
  }
  close(): void {
    this.onClose();
  }
}

const unusedAnalyzer: DiffAnalyzer = { analyze: async () => notUsed() };
const unusedModel: QaModel = {
  generateQuestions: async () => notUsed(),
  judgeAnswer: async () => notUsed(),
  summarize: async () => notUsed()
};
const unusedStore: SessionStore = {
  list: async () => [],
  load: async () => null,
  remove: async () => {},
  save: async () => {}
};

interface Recorder {
  closed: boolean;
  configLoads: number;
  terminalsCreated: number;
  targets: GateTarget[];
}

const stagedChange: StagedChanges = {
  kind: "staged",
  changedFiles: ["src/a.ts"],
  diff: "diff --git a/src/a.ts b/src/a.ts\n+x\n",
  parent: PARENT,
  tree: TREE
};

function runtimeFor(
  config: SekisyoConfig,
  options: {
    readonly staged?: StagedChanges;
    readonly terminal?: boolean;
  } = {}
): { readonly runtime: PreCommitHookRuntime; readonly recorder: Recorder } {
  const recorder: Recorder = {
    closed: false,
    configLoads: 0,
    terminalsCreated: 0,
    targets: []
  };
  const runtime: PreCommitHookRuntime = {
    createDependencies: (context, terminal) => ({
      analyzer: unusedAnalyzer,
      model: unusedModel,
      store: context.store,
      terminal
    }),
    createStore: async () => unusedStore,
    createTerminal: () => {
      recorder.terminalsCreated += 1;
      return options.terminal === false
        ? undefined
        : new FakeTerminal(() => {
            recorder.closed = true;
          });
    },
    findRepositoryRoot: async () => "/repo",
    loadConfig: async () => {
      recorder.configLoads += 1;
      return config;
    },
    readStagedChanges: async () => options.staged ?? stagedChange,
    runGate: async (_dependencies, _config, target): Promise<SessionRecord> => {
      recorder.targets.push(target);
      return passedSession(bindingFor(), "gate");
    }
  };
  return { runtime, recorder };
}

describe("isAgentEnvironment", () => {
  test("エージェントのシェルの目印を検出する", () => {
    expect(isAgentEnvironment({ CLAUDECODE: "1" })).toBe(true);
    expect(isAgentEnvironment({ AI_AGENT: "claude-code" })).toBe(true);
    expect(isAgentEnvironment({ CLAUDECODE: "" })).toBe(false);
    expect(isAgentEnvironment({ HOME: "/home/user" })).toBe(false);
  });
});

describe("runPreCommitHook", () => {
  test("commit時の試問が無効なら試問しない", async () => {
    const { runtime, recorder } = runtimeFor(parseConfig({}));
    expect(
      await runPreCommitHook({ cwd: "/repo", environment: HUMAN }, runtime)
    ).toBe(0);
    expect(recorder.targets).toHaveLength(0);
    expect(recorder.closed).toBe(true);
  });

  test("エージェントのシェルでは設定も読まず端末も開かずに通す", async () => {
    const stderr = captureStderr();
    const { runtime, recorder } = runtimeFor(enabled);
    expect(
      await runPreCommitHook(
        { cwd: "/repo", environment: { CLAUDECODE: "1" } },
        runtime
      )
    ).toBe(0);
    expect(recorder.configLoads).toBe(0);
    expect(recorder.terminalsCreated).toBe(0);
    expect(stderr).toEqual([AGENT_SKIP_MESSAGE]);
  });

  test("対話できる端末が無い（IDEなど）なら設定を読まずに通す", async () => {
    const stderr = captureStderr();
    const { runtime, recorder } = runtimeFor(enabled, { terminal: false });
    expect(
      await runPreCommitHook({ cwd: "/repo", environment: HUMAN }, runtime)
    ).toBe(0);
    expect(recorder.configLoads).toBe(0);
    expect(recorder.targets).toHaveLength(0);
    expect(stderr).toEqual([AGENT_SKIP_MESSAGE]);
  });

  test.each([
    [{ kind: "initial_commit" } as const, "最初のコミット"],
    [{ kind: "merge_in_progress" } as const, "マージの確定"]
  ])("試問を省く状況では通す: %o", async (staged, message) => {
    const stderr = captureStderr();
    const { runtime, recorder } = runtimeFor(enabled, { staged });
    expect(
      await runPreCommitHook({ cwd: "/repo", environment: HUMAN }, runtime)
    ).toBe(0);
    expect(recorder.targets).toHaveLength(0);
    expect(stderr.join("\n")).toContain(message);
    expect(recorder.closed).toBe(true);
  });

  test("ステージした内容のツリーと親に束縛して試問する", async () => {
    const { runtime, recorder } = runtimeFor(enabled);
    expect(
      await runPreCommitHook({ cwd: "/repo", environment: HUMAN }, runtime)
    ).toBe(0);
    expect(recorder.targets).toHaveLength(1);
    expect(recorder.targets[0]).toMatchObject({
      analysisTarget: { kind: "base", baseRef: PARENT },
      base: PARENT,
      head: TREE,
      ref: `index@${TREE}`,
      remote: COMMIT_RECORD_REMOTE
    });
    expect(recorder.closed).toBe(true);
  });

  test("除外パスを含む変更は内容を読まずに止める", async () => {
    const { runtime, recorder } = runtimeFor(enabled, {
      staged: { ...stagedChange, changedFiles: ["config/secrets/token.txt"] }
    });
    await expect(
      runPreCommitHook({ cwd: "/repo", environment: HUMAN }, runtime)
    ).rejects.toMatchObject({ code: "privacy_exclusion" });
    expect(recorder.targets).toHaveLength(0);
    expect(recorder.closed).toBe(true);
  });
});
