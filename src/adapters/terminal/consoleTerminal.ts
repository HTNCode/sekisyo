import { createReadStream, createWriteStream, openSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export interface SelectOption<T extends string> {
  readonly label: string;
  readonly value: T;
}

export class ConsoleTerminal {
  private readonly reader;

  public constructor(
    input: Readable,
    private readonly output: Writable
  ) {
    this.reader = createInterface({
      input,
      output,
      terminal: true
    });
  }

  public write(message: string): void {
    this.output.write(`${message}\n`);
  }

  public error(message: string): void {
    this.output.write(`Error: ${message}\n`);
  }

  public async prompt(message: string): Promise<string> {
    return (await this.reader.question(`${message}\n> `)).trim();
  }

  public async confirm(
    message: string,
    defaultValue = false
  ): Promise<boolean> {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await this.reader.question(`${message} ${suffix} `))
      .trim()
      .toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }
    return answer === "y" || answer === "yes";
  }

  public async select<T extends string>(
    message: string,
    options: readonly SelectOption<T>[]
  ): Promise<T> {
    if (options.length === 0) {
      throw new Error("A selection requires at least one option.");
    }

    this.write(message);
    for (const [index, option] of options.entries()) {
      this.write(`  ${index + 1}. ${option.label}`);
    }

    while (true) {
      const answer = await this.prompt(
        `番号を選択してください (1-${options.length})`
      );
      const selectedIndex = Number(answer) - 1;
      const selected = options[selectedIndex];
      if (
        Number.isInteger(selectedIndex) &&
        selectedIndex >= 0 &&
        selected !== undefined
      ) {
        return selected.value;
      }
      this.write("有効な番号を入力してください。");
    }
  }

  public close(): void {
    this.reader.close();
  }
}

function openControllingTerminal(): ConsoleTerminal | undefined {
  const inputPath = process.platform === "win32" ? "CONIN$" : "/dev/tty";
  const outputPath = process.platform === "win32" ? "CONOUT$" : "/dev/tty";

  try {
    const inputFd = openSync(inputPath, "r");
    const outputFd = openSync(outputPath, "w");
    const input = createReadStream(inputPath, {
      autoClose: true,
      fd: inputFd
    });
    const output = createWriteStream(outputPath, {
      autoClose: true,
      fd: outputFd
    });
    return new ConsoleTerminal(input, output);
  } catch {
    return undefined;
  }
}

export function createConsoleTerminal(
  requireControllingTerminal = false
): ConsoleTerminal | undefined {
  if (
    !requireControllingTerminal &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true
  ) {
    return new ConsoleTerminal(process.stdin, process.stdout);
  }
  return openControllingTerminal();
}
