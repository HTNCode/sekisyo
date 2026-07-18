import { findRepositoryRoot } from "../adapters/git/gitRepository.ts";
import { createConsoleTerminal } from "../adapters/terminal/consoleTerminal.ts";
import {
  SEKISYO_CONFIG_FILE,
  SEKISYO_CONFIG_TEMPLATE
} from "../config/parse.ts";
import { installPrePushHook } from "../hook/install.ts";

function aliasInstructions(): string {
  if (process.platform === "win32") {
    return [
      "PowerShellの現在のセッションで使う例:",
      "  function git {",
      '    if ($args.Count -gt 0 -and $args[0] -in @("ask", "pr")) {',
      "      & sekisyo @args",
      "    } else {",
      "      & git.exe @args",
      "    }",
      "  }",
      "Sekisyoのstatus/clean/initは `sekisyo <command>` で実行します。"
    ].join("\n");
  }
  return [
    "sh / bash / zshの現在のセッションで使う例:",
    "  git() {",
    '    case "${1:-}" in',
    '      ask|pr) command sekisyo "$@" ;;',
    '      *) command git "$@" ;;',
    "    esac",
    "  }",
    "Sekisyoのstatus/clean/initは `sekisyo <command>` で実行します。"
  ].join("\n");
}

export interface InitOptions {
  readonly showAlias?: boolean;
}

export async function runInitCommand(
  cwd: string,
  options: InitOptions = {}
): Promise<number> {
  const repoRoot = await findRepositoryRoot(cwd);
  const configPath = `${repoRoot}/${SEKISYO_CONFIG_FILE}`;
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    await Bun.write(configFile, SEKISYO_CONFIG_TEMPLATE);
    console.log(`作成: ${configPath}`);
  } else {
    console.log(`保持: ${configPath}（既存設定は上書きしません）`);
  }
  const hookPath = await installPrePushHook(repoRoot);
  console.log(`pre-pushフック: ${hookPath}`);

  let showAlias = options.showAlias === true;
  const terminal = createConsoleTerminal();
  try {
    if (!showAlias && terminal !== undefined) {
      terminal.write(
        "Git本来のコマンドを保ったまま `git ask` / `git pr` を追加できます。"
      );
      showAlias = await terminal.confirm(
        "任意のシェルラッパー設定例を表示しますか?"
      );
    }
    if (showAlias) {
      console.log(aliasInstructions());
    }
  } finally {
    terminal?.close();
  }
  console.log("初期化しました。次に `sekisyo ask` を実行できます。");
  return 0;
}
