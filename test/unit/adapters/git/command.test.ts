import { afterEach, describe, expect, test } from "bun:test";
import {
  assertNotTimedOut,
  CommandError,
  describeCommandFailure,
  runCheckedCommand,
  runCheckedCommandWithStdoutLimit,
  runCommand
} from "../../../../src/adapters/git/command.ts";

const SECRET_NAME = "OPENAI_API_KEY";
const MARKER_NAME = "SEKISYO_TEST_MARKER";
const PRINT_ENVIRONMENT = `console.log(
  JSON.stringify({
    secret: process.env.${SECRET_NAME} ?? null,
    marker: process.env.${MARKER_NAME} ?? null
  })
)`;
const SLEEP = "await Bun.sleep(10_000)";
// SIGTERM を捕まえて 0 で終了する子プロセス。打ち切られた出力が
// 「正常な結果」として返らないことを確かめるために使う。
const TRAP_SIGTERM = `process.on("SIGTERM", () => process.exit(0));
console.log("partial");
await Bun.sleep(10_000)`;

const restoreEnvironment: (() => void)[] = [];

function setEnvironment(name: string, value: string): void {
  const previous = process.env[name];
  restoreEnvironment.push(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
  process.env[name] = value;
}

function setSecret(value: string): void {
  setEnvironment(SECRET_NAME, value);
}

afterEach(() => {
  for (const restore of restoreEnvironment.splice(0)) {
    restore();
  }
});

describe("sanitizedEnvironment", () => {
  test(`子プロセスへ ${SECRET_NAME} を渡さない`, async () => {
    setSecret("must-not-leak");
    const result = await runCommand(
      [process.execPath, "-e", PRINT_ENVIRONMENT],
      { cwd: process.cwd(), timeoutMs: 30_000 }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ secret: null, marker: null });
  });

  test("stdout上限付きの経路でも渡さない", async () => {
    setSecret("must-not-leak");
    const result = await runCheckedCommandWithStdoutLimit(
      [process.execPath, "-e", PRINT_ENVIRONMENT],
      { cwd: process.cwd(), timeoutMs: 30_000 },
      64_000
    );

    expect(JSON.parse(result.stdout)).toEqual({ secret: null, marker: null });
  });

  test("denylist外の環境変数はprocess.envから引き継ぐ", async () => {
    setSecret("must-not-leak");
    setEnvironment(MARKER_NAME, "inherited-from-process-env");
    const result = await runCommand(
      [process.execPath, "-e", PRINT_ENVIRONMENT],
      { cwd: process.cwd(), timeoutMs: 30_000 }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      secret: null,
      marker: "inherited-from-process-env"
    });
  });

  test("overridesで渡してもdenylistの変数は落ちる", async () => {
    const result = await runCommand(
      [process.execPath, "-e", PRINT_ENVIRONMENT],
      {
        cwd: process.cwd(),
        env: { [SECRET_NAME]: "must-not-leak", [MARKER_NAME]: "overridden" },
        timeoutMs: 30_000
      }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      secret: null,
      marker: "overridden"
    });
  });

  test("denylist外の環境変数とoverridesは引き継ぐ", async () => {
    setSecret("must-not-leak");
    const result = await runCommand(
      [process.execPath, "-e", PRINT_ENVIRONMENT],
      {
        cwd: process.cwd(),
        env: { SEKISYO_TEST_MARKER: "inherited" },
        timeoutMs: 30_000
      }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      secret: null,
      marker: "inherited"
    });
  });
});

describe("タイムアウト検出", () => {
  test("runCommandはタイムアウトをexit code非ゼロと区別する", async () => {
    const result = await runCommand([process.execPath, "-e", SLEEP], {
      cwd: process.cwd(),
      timeoutMs: 100
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("正常終了ではtimedOutが立たない", async () => {
    const result = await runCommand([process.execPath, "-e", "0"], {
      cwd: process.cwd(),
      timeoutMs: 30_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("runCheckedCommandはタイムアウト専用のメッセージを出す", async () => {
    const promise = runCheckedCommand([process.execPath, "-e", SLEEP], {
      cwd: process.cwd(),
      timeoutMs: 100
    });

    await expect(promise).rejects.toThrow(
      `${process.execPath} timed out after 100ms.`
    );
  });

  test("runCheckedCommandWithStdoutLimitもタイムアウトを明示する", async () => {
    const promise = runCheckedCommandWithStdoutLimit(
      [process.execPath, "-e", SLEEP],
      { cwd: process.cwd(), timeoutMs: 100 },
      64_000
    );

    await expect(promise).rejects.toThrow(
      `${process.execPath} timed out after 100ms.`
    );
  });

  test("SIGTERMを捕まえてexit 0する子プロセスも成功扱いにしない", async () => {
    const result = await runCommand([process.execPath, "-e", TRAP_SIGTERM], {
      cwd: process.cwd(),
      timeoutMs: 300
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("partial");

    await expect(
      runCheckedCommand([process.execPath, "-e", TRAP_SIGTERM], {
        cwd: process.cwd(),
        timeoutMs: 300
      })
    ).rejects.toThrow(`${process.execPath} timed out after 300ms.`);

    await expect(
      runCheckedCommandWithStdoutLimit(
        [process.execPath, "-e", TRAP_SIGTERM],
        { cwd: process.cwd(), timeoutMs: 300 },
        64_000
      )
    ).rejects.toThrow(`${process.execPath} timed out after 300ms.`);
  });

  test("assertNotTimedOutはtimedOutのときだけCommandErrorを投げる", () => {
    const command = ["git", "rev-parse", "--verify", "HEAD^{commit}"];

    expect(() =>
      assertNotTimedOut(
        command,
        { exitCode: 1, stderr: "", stdout: "", timedOut: false },
        60_000
      )
    ).not.toThrow();

    let thrown: unknown;
    try {
      assertNotTimedOut(
        command,
        { exitCode: 0, stderr: "", stdout: "", timedOut: true },
        60_000
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandError);
    expect((thrown as CommandError).message).toBe(
      "git timed out after 60000ms."
    );
    expect((thrown as CommandError).command).toEqual(command);
  });

  test("timeoutMs不明のときは所要時間なしのタイムアウト文言になる", () => {
    expect(
      describeCommandFailure(["git", "status"], {
        exitCode: 0,
        stderr: "",
        stdout: "",
        timedOut: true
      })
    ).toBe("git timed out.");
  });

  test("タイムアウト以外の失敗はexit codeのメッセージを保つ", async () => {
    const promise = runCheckedCommand(
      [process.execPath, "-e", "process.exit(3)"],
      { cwd: process.cwd(), timeoutMs: 30_000 }
    );

    await expect(promise).rejects.toThrow(
      `${process.execPath} exited with code 3.`
    );
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).result.timedOut).toBe(false);
    });
  });
});
