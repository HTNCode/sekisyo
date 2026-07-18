import {
  runAskCommand,
  runCleanCommand,
  runInitCommand,
  runPrePushHook,
  runPrCommand,
  runStatusCommand
} from "./commands/index.ts";
import { SEKISYO_VERSION } from "./version.ts";

const HELP = `Sekisyo CLI — AI生成コードを説明責任つきでレビューへ届ける関所

使い方:
  sekisyo init [--show-alias]
  sekisyo ask [--base <ref>] [--force]
  sekisyo status
  sekisyo pr [--base <branch>] [--title <title>]
  sekisyo clean [--all] [--force]
  sekisyo git <git args...>
  sekisyo <unknown git command...>

pre-pushフック内部:
  sekisyo hook pre-push <remote> <url>

\`git push --no-verify\` によるバイパスはGitの公式仕様どおり利用できます。
`;

interface ParsedOptions {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

function parseOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === undefined) {
      continue;
    }
    if (booleanOptions.has(option)) {
      flags.add(option);
      continue;
    }
    if (valueOptions.has(option)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${option} には値が必要です。`);
      }
      values.set(option, value);
      index += 1;
      continue;
    }
    throw new Error(`不明なオプションです: ${option}`);
  }
  return { flags, values };
}

async function passthroughGit(
  args: readonly string[],
  cwd: string
): Promise<number> {
  if (args.length === 0) {
    throw new Error("`sekisyo git` の後にGitの引数を指定してください。");
  }
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  return child.exited;
}

export async function runCli(
  args: readonly string[],
  cwd = process.cwd()
): Promise<number> {
  const [command, ...rest] = args;
  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(`sekisyo ${SEKISYO_VERSION}`);
    return 0;
  }

  switch (command) {
    case "init": {
      const options = parseOptions(rest, new Set(), new Set(["--show-alias"]));
      return runInitCommand(cwd, {
        showAlias: options.flags.has("--show-alias")
      });
    }
    case "ask": {
      const options = parseOptions(
        rest,
        new Set(["--base"]),
        new Set(["--force"])
      );
      const base = options.values.get("--base");
      return runAskCommand(cwd, {
        ...(base === undefined ? {} : { base }),
        force: options.flags.has("--force")
      });
    }
    case "status":
      parseOptions(rest, new Set(), new Set());
      return runStatusCommand(cwd);
    case "pr": {
      const options = parseOptions(
        rest,
        new Set(["--base", "--title"]),
        new Set()
      );
      const base = options.values.get("--base");
      const title = options.values.get("--title");
      return runPrCommand(cwd, {
        ...(base === undefined ? {} : { base }),
        ...(title === undefined ? {} : { title })
      });
    }
    case "clean": {
      const options = parseOptions(
        rest,
        new Set(),
        new Set(["--all", "--force"])
      );
      return runCleanCommand(cwd, {
        all: options.flags.has("--all"),
        force: options.flags.has("--force")
      });
    }
    case "hook": {
      const [hookName, remote] = rest;
      if (hookName !== "pre-push") {
        throw new Error("対応していないhookです。");
      }
      const stdin = await Bun.stdin.text();
      return runPrePushHook({
        cwd,
        remote,
        stdin
      });
    }
    case "git":
      return passthroughGit(rest, cwd);
    default:
      return passthroughGit(args, cwd);
  }
}

export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "予期しないエラーが発生しました。";
}
