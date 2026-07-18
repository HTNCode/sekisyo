import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOOK_PACKAGE_VERSION,
  installPrePushHook,
  MANAGED_HOOK_MARKER
} from "../../src/hook/install.ts";

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-hook-"));
  temporaryDirectories.push(repo);
  const process = Bun.spawn(["git", "init", "-b", "main"], {
    cwd: repo,
    stdout: "ignore",
    stderr: "pipe"
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(process.stderr).text());
  }
  const configureHooks = Bun.spawn(
    ["git", "config", "core.hooksPath", ".git/hooks"],
    { cwd: repo, stdout: "ignore", stderr: "pipe" }
  );
  if ((await configureHooks.exited) !== 0) {
    throw new Error(await new Response(configureHooks.stderr).text());
  }
  return repo;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("installPrePushHook", () => {
  test("installs idempotently but never overwrites an unmanaged hook", async () => {
    const repo = await createRepository();
    const hookPath = await installPrePushHook(repo);

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
    expect(await installPrePushHook(repo)).toBe(hookPath);
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
});
