import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli.ts";

const temporaryDirectories: string[] = [];

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
