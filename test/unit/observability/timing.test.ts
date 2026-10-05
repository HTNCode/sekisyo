import { describe, expect, test } from "bun:test";

import {
  createPhaseTimer,
  formatPhaseDuration,
  isTimingEnabled,
  noopPhaseTimer,
  resolvePhaseTimer,
  TIMING_ENVIRONMENT_VARIABLE
} from "../../../src/observability/timing.ts";

describe("isTimingEnabled", () => {
  test.each(["1", "true", "yes", "on", "verbose", " 1 "])(
    "%p は計測を有効にする",
    (value) => {
      expect(isTimingEnabled({ [TIMING_ENVIRONMENT_VARIABLE]: value })).toBe(
        true
      );
    }
  );

  test.each(["", "0", "false", "no", "off", "FALSE", " off "])(
    "%p は計測を有効にしない",
    (value) => {
      expect(isTimingEnabled({ [TIMING_ENVIRONMENT_VARIABLE]: value })).toBe(
        false
      );
    }
  );

  test("未設定なら計測を有効にしない", () => {
    expect(isTimingEnabled({})).toBe(false);
  });
});

describe("createPhaseTimer", () => {
  test("フェーズ名と所要時間を1行で出力し、戻り値はそのまま返す", async () => {
    const lines: string[] = [];
    let currentMs = 100;
    const timer = createPhaseTimer({
      now: () => currentMs,
      write: (line) => lines.push(line)
    });

    const value = await timer.measure("snapshot", async () => {
      currentMs = 2_600;
      return "analysed";
    });

    expect(value).toBe("analysed");
    expect(lines).toEqual(["sekisyo[timing] snapshot 2500.0ms"]);
  });

  test("失敗したフェーズも所要時間を出力して例外を透過させる", async () => {
    const lines: string[] = [];
    let currentMs = 0;
    const timer = createPhaseTimer({
      now: () => currentMs,
      write: (line) => lines.push(line)
    });
    const failure = new Error("codex failed");

    await expect(
      timer.measure("codex-analysis", async () => {
        currentMs = 12;
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(lines).toEqual(["sekisyo[timing] codex-analysis 12.0ms"]);
  });

  test("入れ子のフェーズは内側から出力される", async () => {
    const lines: string[] = [];
    const timer = createPhaseTimer({
      now: () => 0,
      write: (l) => lines.push(l)
    });

    await timer.measure("snapshot", async () => {
      await timer.measure("snapshot:objects", async () => undefined);
    });

    expect(lines.map((line) => line.split(" ")[1])).toEqual([
      "snapshot:objects",
      "snapshot"
    ]);
  });
});

describe("noopPhaseTimer", () => {
  test("何も出力せず処理だけを実行する", async () => {
    let calls = 0;
    const value = await noopPhaseTimer().measure("snapshot", async () => {
      calls += 1;
      return 7;
    });

    expect(value).toBe(7);
    expect(calls).toBe(1);
  });
});

describe("resolvePhaseTimer", () => {
  test("環境変数が無効なら何も出力しない", async () => {
    const lines: string[] = [];
    const timer = resolvePhaseTimer({}, { write: (line) => lines.push(line) });

    await timer.measure("git-state", async () => undefined);

    expect(lines).toEqual([]);
  });

  test("環境変数が有効なら計測して出力する", async () => {
    const lines: string[] = [];
    const timer = resolvePhaseTimer(
      { [TIMING_ENVIRONMENT_VARIABLE]: "1" },
      { now: () => 0, write: (line) => lines.push(line) }
    );

    await timer.measure("git-state", async () => undefined);

    expect(lines).toEqual(["sekisyo[timing] git-state 0.0ms"]);
  });
});

describe("formatPhaseDuration", () => {
  test("小数第1位まで固定して出力する", () => {
    expect(formatPhaseDuration("snapshot:extract", 3.14159)).toBe(
      "sekisyo[timing] snapshot:extract 3.1ms"
    );
  });
});
