import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  HOOK_PACKAGE_VERSION,
  installPrePushHook,
  MANAGED_HOOK_MARKER,
  renderManagedHook,
  renderPrePushHook,
  uninstallPrePushHook
} from "../../src/hook/install.ts";

const temporaryDirectories: string[] = [];
const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL;

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });
  if ((await child.exited) !== 0) {
    throw new Error(await new Response(child.stderr).text());
  }
  return (await new Response(child.stdout).text()).trim();
}

async function createBareRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-hook-"));
  temporaryDirectories.push(repo);
  await git(repo, ["init", "-b", "main"]);
  return repo;
}

async function createRepository(): Promise<string> {
  const repo = await createBareRepository();
  await git(repo, ["config", "core.hooksPath", ".git/hooks"]);
  return repo;
}

/** 利用者のグローバル設定に core.hooksPath がある状態を、一時ファイルで再現する。 */
async function useGlobalHooksPath(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "sekisyo-global-"));
  temporaryDirectories.push(home);
  const sharedHooks = join(home, "git-hooks");
  const globalConfig = join(home, "gitconfig");
  await writeFile(globalConfig, `[core]\n\thooksPath = ${sharedHooks}\n`);
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  return sharedHooks;
}

afterEach(async () => {
  if (originalGlobalConfig === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("installPrePushHook", () => {
  test("installs idempotently but never overwrites an unmanaged hook", async () => {
    const repo = await createRepository();
    const { hookPath, sharedHooksPath } = await installPrePushHook(repo);
    expect(sharedHooksPath).toBeUndefined();

    const installedHook = await readFile(hookPath, "utf8");
    expect(installedHook).toContain(MANAGED_HOOK_MARKER);
    expect(installedHook).toContain(
      `bunx --bun sekisyo@${HOOK_PACKAGE_VERSION} hook pre-push`
    );
    expect(installedHook).toContain(
      `"$installed_version" = "sekisyo ${HOOK_PACKAGE_VERSION}"`
    );
    await writeFile(
      hookPath,
      installedHook.replace(`sekisyo@${HOOK_PACKAGE_VERSION}`, "sekisyo"),
      "utf8"
    );
    expect((await installPrePushHook(repo)).hookPath).toBe(hookPath);
    expect(await readFile(hookPath, "utf8")).toBe(installedHook);

    const unmanagedHook = "#!/bin/sh\necho custom\n";
    await writeFile(hookPath, unmanagedHook, "utf8");

    expect(installPrePushHook(repo)).rejects.toThrow("did not overwrite");
    expect(await readFile(hookPath, "utf8")).toBe(unmanagedHook);
  }, 15_000);

  test("custom hooksPathにある既存hookも上書きしない", async () => {
    const repo = await createRepository();
    const configureHooks = Bun.spawn(
      ["git", "config", "core.hooksPath", ".githooks"],
      { cwd: repo, stdout: "ignore", stderr: "pipe" }
    );
    if ((await configureHooks.exited) !== 0) {
      throw new Error(await new Response(configureHooks.stderr).text());
    }
    const hookDirectory = join(repo, ".githooks");
    const hookPath = join(hookDirectory, "pre-push");
    const unmanagedHook = "#!/bin/sh\necho keep-custom-hook\n";
    await mkdir(hookDirectory, { recursive: true });
    await writeFile(hookPath, unmanagedHook, "utf8");

    expect(installPrePushHook(repo)).rejects.toThrow("did not overwrite");
    expect(await readFile(hookPath, "utf8")).toBe(unmanagedHook);
  }, 15_000);

  test("グローバルのhooksPathには書かず、リポジトリ側のhooksへ設置する", async () => {
    const sharedHooks = await useGlobalHooksPath();
    const repo = await createBareRepository();

    const { hookPath, sharedHooksPath } = await installPrePushHook(repo);

    expect(hookPath).toBe(
      join(
        await git(repo, ["rev-parse", "--absolute-git-dir"]),
        "hooks",
        "pre-push"
      )
    );
    expect(sharedHooksPath).toBe(sharedHooks);
    expect(await readFile(hookPath, "utf8")).toContain(MANAGED_HOOK_MARKER);
    expect(Bun.file(join(sharedHooks, "pre-push")).exists()).resolves.toBe(
      false
    );
  }, 15_000);

  test("worktreeからでも共有のGitディレクトリへ設置する", async () => {
    await useGlobalHooksPath();
    const repo = await createBareRepository();
    await git(repo, [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "init"
    ]);
    const worktree = join(repo, "..", `${basename(repo)}-wt`);
    temporaryDirectories.push(worktree);
    await git(repo, ["worktree", "add", worktree]);

    const { hookPath } = await installPrePushHook(worktree);

    expect(hookPath).toBe(
      join(
        await git(repo, ["rev-parse", "--absolute-git-dir"]),
        "hooks",
        "pre-push"
      )
    );
  }, 15_000);
});

describe("uninstallPrePushHook", () => {
  test("Sekisyoが設置したフックだけを削除する", async () => {
    await useGlobalHooksPath();
    const repo = await createBareRepository();
    const { hookPath } = await installPrePushHook(repo);

    expect(await uninstallPrePushHook(repo)).toEqual({
      hookPath,
      result: "removed"
    });
    expect(Bun.file(hookPath).exists()).resolves.toBe(false);
    expect(await uninstallPrePushHook(repo)).toEqual({
      hookPath,
      result: "not_found"
    });

    const unmanagedHook = "#!/bin/sh\necho keep\n";
    await writeFile(hookPath, unmanagedHook, "utf8");
    expect(await uninstallPrePushHook(repo)).toEqual({
      hookPath,
      result: "unmanaged"
    });
    expect(await readFile(hookPath, "utf8")).toBe(unmanagedHook);
  }, 15_000);
});

describe("renderManagedHook", () => {
  test("pre-pushは従来どおり、sekisyoが無ければbunxで起動し、それも無ければ止める", () => {
    expect(renderManagedHook("pre-push")).toBe(renderPrePushHook());
    expect(renderPrePushHook()).toContain("bunx --bun sekisyo@");
    expect(renderPrePushHook()).toMatch(/exit 1\n$/u);
  });

  test("pre-commitはsekisyoを起動できなくてもcommitを止めない", () => {
    const hook = renderManagedHook("pre-commit");
    expect(hook).toContain("exec sekisyo hook pre-commit");
    expect(hook).not.toContain("bunx");
    expect(hook).toMatch(/exit 0\n$/u);
    expect(hook).toContain("SEKISYO_PRE_COMMIT_ACTIVE");
  });
});
