import {
  runAskCommand,
  runCleanCommand,
  runInitCommand,
  runPrePushHook,
  runPrCommand,
  runStatusCommand
} from "./commands/index.ts";
import { EXIT_CODE } from "./application/errors.ts";
import { SEKISYO_VERSION } from "./version.ts";

const HELP = `Sekisyo CLI — AI生成コードを説明責任つきでレビューへ届ける関所

使い方:
  sekisyo init [--show-alias | --no-alias]
  sekisyo ask [--base <ref>] [--force]
  sekisyo status
  sekisyo pr [--base <branch>] [--title <title>]
  sekisyo clean [--all] [--force]
  sekisyo git <git args...>
  sekisyo <unknown git command...>

init / ask / status / pr / clean では --help / --version を任意の位置で
受け付けます。内部用の hook は対象外です。

pre-pushフック内部:
  sekisyo hook pre-push <remote> <url>

\`git push --no-verify\` によるバイパスはGitの公式仕様どおり利用できます。

終了コード:
  0 正常終了
  1 未通過、または一般的な失敗
  2 利用者が中断した
  3 実行環境に起因する中断（対話端末がない、入力がEOFに達した）
  4 秘密情報として除外されたパスが差分に含まれるため、読まずに中断した
`;

const HELP_OPTIONS: readonly string[] = ["--help", "-h"];
const VERSION_OPTIONS: readonly string[] = ["--version", "-v"];
const HELP_HINT = "`sekisyo --help` で使い方を確認できます。";

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
      if (value === undefined) {
        throw new Error(`${option} には値が必要です。${HELP_HINT}`);
      }
      // 既知のオプション名（-h / -v のような短縮形も含む）を値として飲み込むと、
      // 解析を素通りして副作用のあるコマンドが走るため、ここで弾く。
      if (
        value.startsWith("--") ||
        booleanOptions.has(value) ||
        valueOptions.has(value)
      ) {
        throw new Error(
          `${option} の値に別のオプション ${value} が来ています。${option} の値を指定してください。${HELP_HINT}`
        );
      }
      values.set(option, value);
      index += 1;
      continue;
    }
    throw new Error(`不明なオプションです: ${option}。${HELP_HINT}`);
  }
  return { flags, values };
}

/**
 * --help / --version はサブコマンドの後ろでも受け付ける。値を取るオプションの
 * 値として現れた `--help` を拾わないよう、判定はパース結果に対して行う。
 */
function parseCommandOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>
): ParsedOptions {
  return parseOptions(
    args,
    valueOptions,
    new Set([...booleanOptions, ...HELP_OPTIONS, ...VERSION_OPTIONS])
  );
}

/** --help / --version が指定されていれば出力して終了コードを返す。 */
function helpOrVersionExit(flags: ReadonlySet<string>): number | undefined {
  if (HELP_OPTIONS.some((option) => flags.has(option))) {
    console.log(HELP);
    return EXIT_CODE.success;
  }
  if (VERSION_OPTIONS.some((option) => flags.has(option))) {
    console.log(`sekisyo ${SEKISYO_VERSION}`);
    return EXIT_CODE.success;
  }
  return undefined;
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
    HELP_OPTIONS.includes(command)
  ) {
    console.log(HELP);
    return EXIT_CODE.success;
  }
  if (VERSION_OPTIONS.includes(command)) {
    console.log(`sekisyo ${SEKISYO_VERSION}`);
    return EXIT_CODE.success;
  }

  switch (command) {
    case "init": {
      const options = parseCommandOptions(
        rest,
        new Set(),
        new Set(["--show-alias", "--no-alias"])
      );
      const early = helpOrVersionExit(options.flags);
      if (early !== undefined) {
        return early;
      }
      const showAlias = options.flags.has("--show-alias");
      const noAlias = options.flags.has("--no-alias");
      if (showAlias && noAlias) {
        throw new Error("--show-alias と --no-alias は同時に指定できません。");
      }
      return runInitCommand(cwd, { noAlias, showAlias });
    }
    case "ask": {
      const options = parseCommandOptions(
        rest,
        new Set(["--base"]),
        new Set(["--force"])
      );
      const early = helpOrVersionExit(options.flags);
      if (early !== undefined) {
        return early;
      }
      const base = options.values.get("--base");
      return runAskCommand(cwd, {
        ...(base === undefined ? {} : { base }),
        force: options.flags.has("--force")
      });
    }
    case "status": {
      const options = parseCommandOptions(rest, new Set(), new Set());
      const early = helpOrVersionExit(options.flags);
      if (early !== undefined) {
        return early;
      }
      return runStatusCommand(cwd);
    }
    case "pr": {
      const options = parseCommandOptions(
        rest,
        new Set(["--base", "--title"]),
        new Set()
      );
      const early = helpOrVersionExit(options.flags);
      if (early !== undefined) {
        return early;
      }
      const base = options.values.get("--base");
      const title = options.values.get("--title");
      return runPrCommand(cwd, {
        ...(base === undefined ? {} : { base }),
        ...(title === undefined ? {} : { title })
      });
    }
    case "clean": {
      const options = parseCommandOptions(
        rest,
        new Set(),
        new Set(["--all", "--force"])
      );
      const early = helpOrVersionExit(options.flags);
      if (early !== undefined) {
        return early;
      }
      return runCleanCommand(cwd, {
        all: options.flags.has("--all"),
        force: options.flags.has("--force")
      });
    }
    case "hook": {
      const [hookName, remote] = rest;
      if (hookName !== undefined && HELP_OPTIONS.includes(hookName)) {
        console.log(HELP);
        return EXIT_CODE.success;
      }
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
