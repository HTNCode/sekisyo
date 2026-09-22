import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInitCommand, type InitRuntime } from "../../src/commands/init.ts";
import { TerminalInputClosedError } from "../../src/ports/terminal.ts";

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-init-"));
  temporaryDirectories.push(repo);
  const initialized = Bun.spawn(["git", "init", "-b", "main"], {
    cwd: repo,
    stdout: "ignore",
    stderr: "pipe"
  });
  if ((await initialized.exited) !== 0) {
    throw new Error(await new Response(initialized.stderr).text());
  }
  const configureHooks = Bun.spawn(
    ["git", "config", "core.hooksPath", ".git/hooks"],
    { cwd: repo, stdout: "ignore", stderr: "pipe" }
  );
  if ((await configureHooks.exited) !== 0) {
    throw new Error(await new Response(configureHooks.stderr).text());
  }
  return repo;
}

class RecordingTerminal {
  closed = false;
  readonly messages: string[] = [];

  public constructor(
    private readonly answer: boolean | Error = false,
    public confirmCalls = 0
  ) {}

  public write(message: string): void {
    this.messages.push(message);
  }

  public async confirm(_message: string): Promise<boolean> {
    this.confirmCalls += 1;
    if (this.answer instanceof Error) {
      throw this.answer;
    }
    return this.answer;
  }

  public close(): void {
    this.closed = true;
  }
}

function runtimeFor(terminal: RecordingTerminal | undefined): InitRuntime {
  return { createTerminal: () => terminal };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("runInitCommand", () => {
  test("エイリアス案内の確認でEOFになっても初期化は成功として終わる", async () => {
    const repo = await createRepository();
    const terminal = new RecordingTerminal(new TerminalInputClosedError());

    await expect(runInitCommand(repo, {}, runtimeFor(terminal))).resolves.toBe(
      0
    );
    expect(terminal.confirmCalls).toBe(1);
    expect(terminal.closed).toBeTrue();
    expect(await Bun.file(join(repo, ".sekisyo.yml")).exists()).toBeTrue();
    expect(
      await Bun.file(join(repo, ".git", "hooks", "pre-push")).exists()
    ).toBeTrue();
  });

  test("EOF以外のエラーは握りつぶさず伝播する", async () => {
    const repo = await createRepository();
    const failure = new Error("端末アダプタの想定外エラー");

    await expect(
      runInitCommand(repo, {}, runtimeFor(new RecordingTerminal(failure)))
    ).rejects.toBe(failure);
  });

  test("端末がない場合は確認せず初期化する", async () => {
    const repo = await createRepository();

    await expect(runInitCommand(repo, {}, runtimeFor(undefined))).resolves.toBe(
      0
    );
    expect(await Bun.file(join(repo, ".sekisyo.yml")).exists()).toBeTrue();
  });

  test("--show-aliasが指定済みなら確認しない", async () => {
    const repo = await createRepository();
    const terminal = new RecordingTerminal(true);

    await expect(
      runInitCommand(repo, { showAlias: true }, runtimeFor(terminal))
    ).resolves.toBe(0);
    expect(terminal.confirmCalls).toBe(0);
  });
});
