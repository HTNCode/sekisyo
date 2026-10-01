import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli.ts";
import { SEKISYO_VERSION } from "../../src/version.ts";

const temporaryDirectories: string[] = [];

/** 実リポジトリを触らせないための、Git管理下でない一時ディレクトリ */
async function createScratchDirectory(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sekisyo-cli-scratch-"));
  temporaryDirectories.push(cwd);
  return cwd;
}

async function createEmptyGitConfig(): Promise<{
  readonly configPath: string;
  readonly cwd: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "sekisyo-cli-"));
  temporaryDirectories.push(cwd);
  const configPath = join(cwd, "empty.gitconfig");
  await writeFile(configPath, "", "utf8");
  return { configPath, cwd };
}

/** console.log の出力を集める。runCli はヘルプと版を console.log に書く。 */
function captureLog(): { readonly lines: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  });
  return { lines: () => lines.join("\n"), restore: () => spy.mockRestore() };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("Sekisyo CLI Git passthrough", () => {
  test("明示gitと未知コマンドの終了コードをそのまま返す", async () => {
    const { configPath, cwd } = await createEmptyGitConfig();
    const gitArguments = [
      "config",
      "--file",
      configPath,
      "--get",
      "missing.key"
    ];

    expect(await runCli(["git", ...gitArguments], cwd)).toBe(1);
    expect(await runCli(gitArguments, cwd)).toBe(1);
  });

  test("公開entrypointもGitの非zero終了コードを保持する", async () => {
    const { configPath, cwd } = await createEmptyGitConfig();
    const entrypoint = fileURLToPath(
      new URL("../../src/bin/sekisyo.ts", import.meta.url)
    );
    const child = Bun.spawn(
      [
        process.execPath,
        entrypoint,
        "git",
        "config",
        "--file",
        configPath,
        "--get",
        "missing.key"
      ],
      {
        cwd,
        stdout: "ignore",
        stderr: "pipe"
      }
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text()
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
  }, 15_000);
});

describe("Sekisyo CLI のヘルプと版表示", () => {
  test("コマンドなし・help・--help・-h はヘルプを表示して0で終了する", async () => {
    const cwd = await createScratchDirectory();
    const log = captureLog();
    try {
      for (const args of [[], ["help"], ["--help"], ["-h"]]) {
        expect(await runCli(args, cwd)).toBe(0);
      }
    } finally {
      log.restore();
    }

    expect(log.lines()).toContain("使い方:");
    expect(log.lines()).toContain("終了コード:");
  });

  test("サブコマンドの後ろの --help / -h でもヘルプを表示して0で終了する", async () => {
    const cwd = await createScratchDirectory();
    const log = captureLog();
    try {
      expect(await runCli(["status", "--help"], cwd)).toBe(0);
      expect(await runCli(["status", "-h"], cwd)).toBe(0);
      expect(await runCli(["clean", "--all", "--help"], cwd)).toBe(0);
      expect(await runCli(["pr", "--base", "main", "--help"], cwd)).toBe(0);
    } finally {
      log.restore();
    }

    expect(log.lines()).toContain("使い方:");
  });

  test("サブコマンドの後ろの --version / -v でも版を表示して0で終了する", async () => {
    const cwd = await createScratchDirectory();
    const log = captureLog();
    try {
      expect(await runCli(["--version"], cwd)).toBe(0);
      expect(await runCli(["ask", "--version"], cwd)).toBe(0);
      expect(await runCli(["status", "-v"], cwd)).toBe(0);
    } finally {
      log.restore();
    }

    expect(log.lines()).toContain(`sekisyo ${SEKISYO_VERSION}`);
  });

  test("git passthroughの引数は横取りしない", async () => {
    const cwd = await createScratchDirectory();
    const log = captureLog();
    try {
      // 本物のgitが応答するため、sekisyo自身の版は console.log へ出ない
      expect(await runCli(["git", "--version"], cwd)).toBe(0);
    } finally {
      log.restore();
    }

    expect(log.lines()).not.toContain(`sekisyo ${SEKISYO_VERSION}`);
  });
});

describe("Sekisyo CLI のオプション検査", () => {
  test("不明なオプションはヘルプへ誘導して失敗する", async () => {
    const cwd = await createScratchDirectory();

    await expect(runCli(["status", "--bogus"], cwd)).rejects.toThrow(
      "不明なオプションです: --bogus。`sekisyo --help` で使い方を確認できます。"
    );
  });

  test("値を取るオプションの値欠落はヘルプへ誘導して失敗する", async () => {
    const cwd = await createScratchDirectory();

    await expect(runCli(["ask", "--base"], cwd)).rejects.toThrow(
      "--base には値が必要です。`sekisyo --help` で使い方を確認できます。"
    );
  });

  /**
   * 短縮形まで弾かないと、オプション解析を素通りして本物の gh / git を呼ぶ
   * `pr` まで到達する。値欠落として弾まることを位置ごとに固定する。
   */
  test("値の位置に現れた既知オプションは値ではなく値欠落として扱う", async () => {
    const cwd = await createScratchDirectory();

    for (const args of [
      ["pr", "--title", "--help"],
      ["pr", "--title", "-h"],
      ["pr", "--title", "-v"],
      ["pr", "--base", "--title"],
      ["ask", "--base", "--force"]
    ]) {
      await expect(runCli(args, cwd)).rejects.toThrow("には値が必要です。");
    }
  });

  test("--show-alias と --no-alias の同時指定は失敗する", async () => {
    const cwd = await createScratchDirectory();

    await expect(
      runCli(["init", "--show-alias", "--no-alias"], cwd)
    ).rejects.toThrow("--show-alias と --no-alias は同時に指定できません。");
  });
});
