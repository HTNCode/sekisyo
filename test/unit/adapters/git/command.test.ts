import { afterEach, describe, expect, test } from "bun:test";
import {
  CommandError,
  runCheckedCommand,
  runCheckedCommandWithStdoutLimit,
  runCommand
} from "../../../../src/adapters/git/command.ts";

const SECRET_NAME = "OPENAI_API_KEY";
const PRINT_ENVIRONMENT = `console.log(
  JSON.stringify({
    secret: process.env.${SECRET_NAME} ?? null,
    marker: process.env.SEKISYO_TEST_MARKER ?? null
  })
)`;
const SLEEP = "await Bun.sleep(10_000)";

const restoreSecret: (() => void)[] = [];

function setSecret(value: string): void {
  const previous = process.env[SECRET_NAME];
  restoreSecret.push(() => {
    if (previous === undefined) {
      delete process.env[SECRET_NAME];
    } else {
      process.env[SECRET_NAME] = previous;
    }
  });
  process.env[SECRET_NAME] = value;
}

afterEach(() => {
  for (const restore of restoreSecret.splice(0)) {
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
