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

export function renderPrePushHook(): string {
  return `#!/bin/sh
${MANAGED_HOOK_MARKER}

if [ "\${SEKISYO_PRE_PUSH_ACTIVE:-}" = "1" ]; then
  echo "sekisyo: recursive pre-push invocation detected" >&2
  exit 1
fi

export SEKISYO_PRE_PUSH_ACTIVE=1

if command -v sekisyo >/dev/null 2>&1; then
  installed_version="$(sekisyo --version 2>/dev/null)"
  if [ "$installed_version" = "sekisyo ${HOOK_PACKAGE_VERSION}" ]; then
    exec sekisyo hook pre-push "$@"
  fi
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx --bun sekisyo@${HOOK_PACKAGE_VERSION} hook pre-push "$@"
fi

echo "sekisyo: version ${HOOK_PACKAGE_VERSION} is required; install it or make bunx available" >&2
exit 1
`;
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

export async function resolvePrePushHookLocation(
  cwd: string
): Promise<PrePushHookLocation> {
  const repoRoot = await findRepositoryRoot(cwd);
  const setting = await readHooksPathSetting(repoRoot);
  if (setting === undefined) {
    return { hookPath: await getGitPath(repoRoot, "hooks/pre-push") };
  }

  if (!REPOSITORY_OWNED_CONFIG_SCOPES.has(setting.scope)) {
    return {
      hookPath: join(await getGitCommonDir(repoRoot), "hooks", "pre-push"),
      sharedHooksPath: setting.value
    };
  }

  const gitResolvedPath = await getGitPath(repoRoot, "hooks/pre-push");
  const expectedPath = join(
    isAbsolute(setting.value)
      ? setting.value
      : resolve(repoRoot, setting.value),
    "pre-push"
  );
  return {
    hookPath:
      comparablePath(gitResolvedPath) === comparablePath(expectedPath)
        ? gitResolvedPath
        : expectedPath
  };
}

export async function installPrePushHook(
  repoRoot: string
): Promise<PrePushHookLocation> {
  const location = await resolvePrePushHookLocation(repoRoot);
  const { hookPath } = location;
  const existingHook = await readExistingHook(hookPath);
  const renderedHook = renderPrePushHook();

  if (existingHook !== undefined && !isManagedHook(existingHook)) {
    throw new Error(
      `Existing pre-push hook found at ${hookPath}. Sekisyo did not overwrite it.`
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

/** Sekisyo が設置したフックだけを消し、利用者自身のフックには触れない。 */
export async function uninstallPrePushHook(
  repoRoot: string
): Promise<{ readonly hookPath: string; readonly result: PrePushHookRemoval }> {
  const { hookPath } = await resolvePrePushHookLocation(repoRoot);
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
