import { runGate } from "../application/index.ts";
import { createConsoleTerminal } from "../adapters/terminal/consoleTerminal.ts";
import { prepareGate } from "./runtime.ts";

export interface AskOptions {
  readonly base?: string;
  readonly force?: boolean;
}

export async function runAskCommand(
  cwd: string,
  options: AskOptions = {}
): Promise<number> {
  const terminal = createConsoleTerminal();
  if (terminal === undefined) {
    throw new Error("対話可能な端末で `sekisyo ask` を実行してください。");
  }
  try {
    const prepared = await prepareGate(cwd, terminal, {
      ...(options.base === undefined ? {} : { base: options.base })
    });
    const session = await runGate(
      prepared.dependencies,
      prepared.config,
      prepared.target,
      { allowReuse: options.force !== true }
    );
    if (session.status === "passed" || session.status === "summarized") {
      terminal.write(`通行手形: ${session.fingerprint.slice(0, 12)}`);
      return 0;
    }
    return 1;
  } finally {
    await terminal.close();
  }
}
