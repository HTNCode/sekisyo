import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { runCommand } from "../adapters/git/command.ts";
import {
  findRepositoryRoot,
  getGitPath
} from "../adapters/git/gitRepository.ts";
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

async function resolvePrePushHookPath(cwd: string): Promise<string> {
  const repoRoot = await findRepositoryRoot(cwd);
  const gitResolvedPath = await getGitPath(repoRoot, "hooks/pre-push");
  const configured = await runCommand(
    ["git", "config", "--path", "--get", "core.hooksPath"],
    { cwd: repoRoot, timeoutMs: 30_000 }
  );
  if (configured.exitCode !== 0 || configured.stdout.trim().length === 0) {
    return gitResolvedPath;
  }

  const configuredRoot = configured.stdout.trim();
  const expectedPath = join(
    isAbsolute(configuredRoot)
      ? configuredRoot
      : resolve(repoRoot, configuredRoot),
    "pre-push"
  );
  return comparablePath(gitResolvedPath) === comparablePath(expectedPath)
    ? gitResolvedPath
    : expectedPath;
}

export async function installPrePushHook(repoRoot: string): Promise<string> {
  const hookPath = await resolvePrePushHookPath(repoRoot);
  const existingHook = await readExistingHook(hookPath);
  const renderedHook = renderPrePushHook();

  const managedPrefix = `#!/bin/sh\n${MANAGED_HOOK_MARKER}\n`;
  if (
    existingHook !== undefined &&
    !existingHook.replaceAll("\r\n", "\n").startsWith(managedPrefix)
  ) {
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
  return hookPath;
}
