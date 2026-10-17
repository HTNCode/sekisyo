import { chmod, mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { assertNotTimedOut, runCommand } from "../adapters/git/command.ts";
import {
  findRepositoryRoot,
  getGitCommonDir,
  getGitPath
} from "../adapters/git/git-repository.ts";
import { SEKISYO_VERSION } from "../version.ts";

export const MANAGED_HOOK_MARKER = "# sekisyo-managed-hook:v1";
export const HOOK_PACKAGE_VERSION = SEKISYO_VERSION;

export type ManagedHookName = "pre-commit" | "pre-push";

// 再帰呼び出しの検出に使う環境変数。フックごとに分けないと、pre-commit の中で
// 走った push などを誤って再帰と判定してしまう。
const ACTIVE_VARIABLE: Readonly<Record<ManagedHookName, string>> = {
  "pre-commit": "SEKISYO_PRE_COMMIT_ACTIVE",
  "pre-push": "SEKISYO_PRE_PUSH_ACTIVE"
};

/**
 * sekisyo を起動できなかったときの振る舞い。push は関所として止めるが、commit は
 * 止めない。commit 時の試問は任意の前倒しで、push 時に必ず試問されるため。
 */
function missingCommandFallback(name: ManagedHookName): string {
  if (name === "pre-commit") {
    return `echo "sekisyo: version ${HOOK_PACKAGE_VERSION} が見つからないため、commit時の試問を省きました。push時に試問します。" >&2
exit 0
`;
  }
  return `if command -v bunx >/dev/null 2>&1; then
  exec bunx --bun sekisyo@${HOOK_PACKAGE_VERSION} hook ${name} "$@"
fi

echo "sekisyo: version ${HOOK_PACKAGE_VERSION} is required; install it or make bunx available" >&2
exit 1
`;
}

export function renderManagedHook(name: ManagedHookName): string {
  const active = ACTIVE_VARIABLE[name];
  return `#!/bin/sh
${MANAGED_HOOK_MARKER}

if [ "\${${active}:-}" = "1" ]; then
  echo "sekisyo: recursive ${name} invocation detected" >&2
  exit 1
fi

export ${active}=1

if command -v sekisyo >/dev/null 2>&1; then
  installed_version="$(sekisyo --version 2>/dev/null)"
  if [ "$installed_version" = "sekisyo ${HOOK_PACKAGE_VERSION}" ]; then
    exec sekisyo hook ${name} "$@"
  fi
fi

${missingCommandFallback(name)}`;
}

export function renderPrePushHook(): string {
  return renderManagedHook("pre-push");
}

async function readExistingHook(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function comparablePath(path: string): string {
  const normalized = normalize(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// local / worktree 以外（global / system / command）の core.hooksPath は他の
// リポジトリと共有されるため、そこへ書くと全リポジトリに関所が掛かってしまう。
const REPOSITORY_OWNED_CONFIG_SCOPES: ReadonlySet<string> = new Set([
  "local",
  "worktree"
]);

interface HooksPathSetting {
  readonly scope: string;
  readonly value: string;
}

export interface PrePushHookLocation {
  readonly hookPath: string;
  /**
   * リポジトリ外で設定された core.hooksPath。設定されている場合、Git は
   * hookPath を直接呼ばないため、共有フック側からの委譲が必要になる。
   */
  readonly sharedHooksPath?: string;
}

export type PrePushHookRemoval = "removed" | "not_found" | "unmanaged";

async function readHooksPathSetting(
  repoRoot: string
): Promise<HooksPathSetting | undefined> {
  const command = [
    "git",
    "config",
    "--show-scope",
    "--path",
    "--get",
    "core.hooksPath"
  ];
  const result = await runCommand(command, {
    cwd: repoRoot,
    timeoutMs: 30_000
  });
  assertNotTimedOut(command, result, 30_000);
  const line = result.stdout.trim();
  if (result.exitCode !== 0 || line.length === 0) {
    return undefined;
  }
  const separator = line.indexOf("\t");
  if (separator < 0) {
    throw new Error("git config --show-scope returned an unexpected format.");
  }
  return {
    scope: line.slice(0, separator),
    value: line.slice(separator + 1)
  };
}

function isManagedHook(content: string): boolean {
  return content
    .replaceAll("\r\n", "\n")
    .startsWith(`#!/bin/sh\n${MANAGED_HOOK_MARKER}\n`);
}

export async function resolveHookLocation(
  cwd: string,
  name: ManagedHookName
): Promise<PrePushHookLocation> {
  const repoRoot = await findRepositoryRoot(cwd);
  const setting = await readHooksPathSetting(repoRoot);
  if (setting === undefined) {
    return { hookPath: await getGitPath(repoRoot, `hooks/${name}`) };
  }

  if (!REPOSITORY_OWNED_CONFIG_SCOPES.has(setting.scope)) {
    return {
      hookPath: join(await getGitCommonDir(repoRoot), "hooks", name),
      sharedHooksPath: setting.value
    };
  }

  const gitResolvedPath = await getGitPath(repoRoot, `hooks/${name}`);
  const expectedPath = join(
    isAbsolute(setting.value)
      ? setting.value
      : resolve(repoRoot, setting.value),
    name
  );
  return {
    hookPath:
      comparablePath(gitResolvedPath) === comparablePath(expectedPath)
        ? gitResolvedPath
        : expectedPath
  };
}

export async function resolvePrePushHookLocation(
  cwd: string
): Promise<PrePushHookLocation> {
  return resolveHookLocation(cwd, "pre-push");
}

export async function installManagedHook(
  repoRoot: string,
  name: ManagedHookName
): Promise<PrePushHookLocation> {
  const location = await resolveHookLocation(repoRoot, name);
  const { hookPath } = location;
  const existingHook = await readExistingHook(hookPath);
  const renderedHook = renderManagedHook(name);

  if (existingHook !== undefined && !isManagedHook(existingHook)) {
    throw new Error(
      `Existing ${name} hook found at ${hookPath}. Sekisyo did not overwrite it.`
    );
  }

  await mkdir(dirname(hookPath), { recursive: true });
  if (existingHook !== renderedHook) {
    await Bun.write(hookPath, renderedHook);
  }
  if (process.platform !== "win32") {
    await chmod(hookPath, 0o755);
  }
  return location;
}

export async function installPrePushHook(
  repoRoot: string
): Promise<PrePushHookLocation> {
  return installManagedHook(repoRoot, "pre-push");
}

/** Sekisyo が設置したフックだけを消し、利用者自身のフックには触れない。 */
export async function uninstallManagedHook(
  repoRoot: string,
  name: ManagedHookName
): Promise<{ readonly hookPath: string; readonly result: PrePushHookRemoval }> {
  const { hookPath } = await resolveHookLocation(repoRoot, name);
  const existingHook = await readExistingHook(hookPath);
  if (existingHook === undefined) {
    return { hookPath, result: "not_found" };
  }
  if (!isManagedHook(existingHook)) {
    return { hookPath, result: "unmanaged" };
  }
  await unlink(hookPath);
  return { hookPath, result: "removed" };
}

export async function uninstallPrePushHook(
  repoRoot: string
): Promise<{ readonly hookPath: string; readonly result: PrePushHookRemoval }> {
  return uninstallManagedHook(repoRoot, "pre-push");
}
