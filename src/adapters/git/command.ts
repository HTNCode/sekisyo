export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

export type CommandExecutor = (
  command: readonly string[],
  options: CommandOptions
) => Promise<CommandResult>;

export class CommandError extends Error {
  public constructor(
    message: string,
    public readonly command: readonly string[],
    public readonly result: CommandResult
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export class CommandOutputLimitError extends Error {
  public constructor(
    public readonly command: readonly string[],
    public readonly maxBytes: number
  ) {
    super(`${command[0]} exceeded the ${maxBytes}-byte stdout limit.`);
    this.name = "CommandOutputLimitError";
  }
}

function sanitizedEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {}
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete environment[name];
    } else {
      environment[name] = value;
    }
  }

  return environment;
}

export async function runCommand(
  command: readonly string[],
  options: CommandOptions
): Promise<CommandResult> {
  if (command.length === 0) {
    throw new Error("Command must include an executable.");
  }

  const processHandle = Bun.spawn([...command], {
    cwd: options.cwd,
    env: sanitizedEnvironment(options.env),
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe"
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs !== undefined) {
    timeout = setTimeout(() => processHandle.kill(), options.timeoutMs);
  }

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited
    ]);

    return {
      exitCode,
      stderr,
      stdout
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function runCheckedCommand(
  command: readonly string[],
  options: CommandOptions
): Promise<CommandResult> {
  const result = await runCommand(command, options);
  if (result.exitCode !== 0) {
    throw new CommandError(
      `${command[0]} exited with code ${result.exitCode}.`,
      command,
      result
    );
  }
  return result;
}

export async function runCheckedCommandWithStdoutLimit(
  command: readonly string[],
  options: CommandOptions,
  maxBytes: number
): Promise<CommandResult> {
  if (command.length === 0) {
    throw new Error("Command must include an executable.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer.");
  }

  const processHandle = Bun.spawn([...command], {
    cwd: options.cwd,
    env: sanitizedEnvironment(options.env),
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe"
  });
  const stderrPromise = new Response(processHandle.stderr).text();
  const reader = processHandle.stdout.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let exceeded = false;
  const timeout =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => processHandle.kill(), options.timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        exceeded = true;
        processHandle.kill();
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const [exitCode, stderr] = await Promise.all([
    processHandle.exited,
    stderrPromise
  ]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
  if (exceeded) {
    throw new CommandOutputLimitError(command, maxBytes);
  }

  const stdout = new TextDecoder().decode(Buffer.concat(chunks));
  const result = { exitCode, stderr, stdout };
  if (exitCode !== 0) {
    throw new CommandError(
      `${command[0]} exited with code ${exitCode}.`,
      command,
      result
    );
  }
  return result;
}

export async function runInheritedCommand(
  command: readonly string[],
  options: Pick<CommandOptions, "cwd" | "env">
): Promise<number> {
  if (command.length === 0) {
    throw new Error("Command must include an executable.");
  }

  const processHandle = Bun.spawn([...command], {
    cwd: options.cwd,
    env: sanitizedEnvironment(options.env),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });

  return processHandle.exited;
}
