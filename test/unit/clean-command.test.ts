import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GateError } from "../../src/application/errors.ts";
import {
  runCleanCommand,
  type CleanRuntime
} from "../../src/commands/clean.ts";
import { createSessionStore } from "../../src/commands/runtime.ts";
import { createSessionRecord } from "../../src/domain/session.ts";
import { TerminalInputClosedError } from "../../src/ports/terminal.ts";
import { bindingFor } from "./support/passed-session.ts";

const temporaryDirectories: string[] = [];

async function createRepositoryWithSession(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-clean-"));
  temporaryDirectories.push(repo);
  const initialized = Bun.spawn(["git", "init", "-b", "main"], {
    cwd: repo,
    stdout: "ignore",
    stderr: "pipe"
  });
  if ((await initialized.exited) !== 0) {
    throw new Error(await new Response(initialized.stderr).text());
  }
  const { store } = await createSessionStore(repo);
  await store.save(
    createSessionRecord(bindingFor(), "2026-10-18T00:00:00.000Z")
  );
  return repo;
}

async function sessionCount(repo: string): Promise<number> {
  const { store } = await createSessionStore(repo);
  return (await store.list()).length;
}

class RecordingTerminal {
  closed = false;

  public constructor(private readonly answer: boolean | Error) {}

  public async confirm(_message: string): Promise<boolean> {
    if (this.answer instanceof Error) {
      throw this.answer;
    }
    return this.answer;
  }

  public close(): void {
    this.closed = true;
  }
}

function runtimeFor(terminal: RecordingTerminal | undefined): CleanRuntime {
  return { createTerminal: () => terminal };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("runCleanCommand", () => {
  test("確認中に入力がEOFになると削除せず --force の導線つきで中断する", async () => {
    const repo = await createRepositoryWithSession();
    const terminal = new RecordingTerminal(new TerminalInputClosedError());

    const error = await runCleanCommand(
      repo,
      { all: true },
      runtimeFor(terminal)
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).code).toBe("interactive_input_closed");
    expect((error as GateError).message).toContain("sekisyo clean --force");
    expect(terminal.closed).toBeTrue();
    expect(await sessionCount(repo)).toBe(1);
  });

  test("端末がなければ削除せず --force を案内する", async () => {
    const repo = await createRepositoryWithSession();

    const error = await runCleanCommand(
      repo,
      { all: true },
      runtimeFor(undefined)
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).code).toBe("interactive_terminal_required");
    expect((error as GateError).message).toContain("sekisyo clean --force");
    expect(await sessionCount(repo)).toBe(1);
  });

  test("EOF以外の端末エラーは変換せずにそのまま伝える", async () => {
    const repo = await createRepositoryWithSession();
    const failure = new Error("terminal failure");
    const terminal = new RecordingTerminal(failure);

    await expect(
      runCleanCommand(repo, { all: true }, runtimeFor(terminal))
    ).rejects.toBe(failure);
    expect(terminal.closed).toBeTrue();
    expect(await sessionCount(repo)).toBe(1);
  });

  test("確認で承認すると記録を削除する", async () => {
    const repo = await createRepositoryWithSession();
    const terminal = new RecordingTerminal(true);
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        runCleanCommand(repo, { all: true }, runtimeFor(terminal))
      ).resolves.toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(terminal.closed).toBeTrue();
    expect(await sessionCount(repo)).toBe(0);
  });

  test("確認で拒否すると削除せず取り消しの終了コードを返す", async () => {
    const repo = await createRepositoryWithSession();
    const terminal = new RecordingTerminal(false);
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        runCleanCommand(repo, { all: true }, runtimeFor(terminal))
      ).resolves.toBe(2);
    } finally {
      log.mockRestore();
    }
    expect(terminal.closed).toBeTrue();
    expect(await sessionCount(repo)).toBe(1);
  });

  test("--force なら確認せずに削除する", async () => {
    const repo = await createRepositoryWithSession();
    const terminal = new RecordingTerminal(new TerminalInputClosedError());
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        runCleanCommand(repo, { all: true, force: true }, runtimeFor(terminal))
      ).resolves.toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(await sessionCount(repo)).toBe(0);
  });
});
