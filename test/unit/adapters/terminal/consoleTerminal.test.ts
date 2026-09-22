import { describe, expect, test } from "bun:test";
import { PassThrough, Readable, Writable } from "node:stream";
import { ConsoleTerminal } from "../../../../src/adapters/terminal/consoleTerminal.ts";
import { TerminalInputClosedError } from "../../../../src/ports/terminal.ts";

function collector(): { readonly stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  return { stream, text: () => chunks.join("") };
}

function terminalFor(lines: readonly string[]): ConsoleTerminal {
  return new ConsoleTerminal(Readable.from([...lines]), collector().stream);
}

/**
 * readlineは質問が保留されていない間に届いた行を捨てるため、回答は質問を
 * 開始したあとに1行ずつ流し込む。実端末の入力タイミングに合わせる目的。
 */
function interactiveTerminal(): {
  readonly answer: (line: string) => Promise<void>;
  readonly output: () => string;
  readonly terminal: ConsoleTerminal;
} {
  const input = new PassThrough();
  const sink = collector();
  return {
    answer: async (line) => {
      input.write(`${line}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    },
    output: sink.text,
    terminal: new ConsoleTerminal(input, sink.stream)
  };
}

/** rejectが指定時間内に起きたことを、ハング（未解決）と区別して確かめる */
async function expectRejectsWithin(
  operation: Promise<unknown>,
  milliseconds: number
): Promise<unknown> {
  const timer = Promise.withResolvers<"timed-out">();
  const handle = setTimeout(() => timer.resolve("timed-out"), milliseconds);
  try {
    const outcome = await Promise.race([
      operation.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ error, kind: "rejected" as const })
      ),
      timer.promise
    ]);
    if (outcome === "timed-out") {
      throw new Error(`${milliseconds}ms以内に解決しませんでした（ハング）。`);
    }
    if (outcome.kind === "resolved") {
      throw new Error(
        `rejectを期待しましたが解決しました: ${JSON.stringify(outcome.value)}`
      );
    }
    return outcome.error;
  } finally {
    clearTimeout(handle);
  }
}

describe("ConsoleTerminal のEOF処理", () => {
  test("空の入力ストリームではpromptが1秒以内にrejectする", async () => {
    const terminal = terminalFor([]);

    const error = await expectRejectsWithin(
      terminal.prompt("あなたの説明"),
      1_000
    );

    expect(error).toBeInstanceOf(TerminalInputClosedError);
  });

  test("回答の途中でEOFになった場合も次のpromptがrejectする", async () => {
    const terminal = terminalFor(["最初の説明\n"]);

    await expect(terminal.prompt("1問目")).resolves.toBe("最初の説明");
    const error = await expectRejectsWithin(terminal.prompt("2問目"), 1_000);

    expect(error).toBeInstanceOf(TerminalInputClosedError);
  });

  test("EOF後に繰り返し質問してもrejectし続ける", async () => {
    const terminal = terminalFor([]);

    await expectRejectsWithin(terminal.prompt("1回目"), 1_000);
    const error = await expectRejectsWithin(terminal.prompt("2回目"), 1_000);

    expect(error).toBeInstanceOf(TerminalInputClosedError);
  });

  test("confirmはEOF時に既定値を返さずrejectする", async () => {
    const terminal = terminalFor([]);

    const error = await expectRejectsWithin(
      terminal.confirm("削除しますか?", true),
      1_000
    );

    expect(error).toBeInstanceOf(TerminalInputClosedError);
  });

  test("selectはEOF時に再入力ループに入らずrejectする", async () => {
    const terminal = terminalFor([]);

    const error = await expectRejectsWithin(
      terminal.select("選んでください", [
        { label: "修正する", value: "fix" },
        { label: "説明する", value: "intentional" }
      ] as const),
      1_000
    );

    expect(error).toBeInstanceOf(TerminalInputClosedError);
  });

  test("入力がある間は従来どおり回答を返す", async () => {
    const session = interactiveTerminal();

    const explanation = session.terminal.prompt("1問目");
    await session.answer("  説明です  ");
    await expect(explanation).resolves.toBe("説明です");

    const proceed = session.terminal.confirm("続けますか?");
    await session.answer("y");
    await expect(proceed).resolves.toBe(true);

    const choice = session.terminal.select("選んでください", [
      { label: "修正する", value: "fix" },
      { label: "説明する", value: "intentional" }
    ] as const);
    await session.answer("2");
    await expect(choice).resolves.toBe("intentional");
  });

  test("有効な番号が来るまでselectは再入力を促す", async () => {
    const session = interactiveTerminal();

    const choice = session.terminal.select("選んでください", [
      { label: "修正する", value: "fix" },
      { label: "説明する", value: "intentional" }
    ] as const);
    await session.answer("0");
    await session.answer("1");

    await expect(choice).resolves.toBe("fix");
    expect(session.output()).toContain("有効な番号を入力してください。");
  });
});
