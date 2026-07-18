import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtomicJsonSessionStore } from "../../src/adapters/filesystem/atomic-json-session-store.ts";
import { readRepositoryDiff } from "../../src/adapters/git/gitRepository.ts";
import { PROMPT_VERSION } from "../../src/application/gate.ts";
import { createPolicyDigest, DEFAULT_CONFIG } from "../../src/config/index.ts";
import { runPrePushHook } from "../../src/commands/hook.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import {
  createSessionRecord,
  transitionSession
} from "../../src/domain/session.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const ZERO_OID = "0".repeat(40);
const temporaryDirectories: string[] = [];

async function git(repo: string, args: readonly string[]): Promise<string> {
  const processHandle = Bun.spawn(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text()
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return stdout.trim();
}

async function createTwoCommitRepository(): Promise<{
  readonly featureOid: string;
  readonly mainOid: string;
  readonly repo: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), "sekisyo-pre-push-"));
  temporaryDirectories.push(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "core.hooksPath", ".git/test-hooks"]);
  await git(repo, ["config", "user.name", "Sekisyo Test"]);
  await git(repo, ["config", "user.email", "sekisyo@example.invalid"]);

  await writeFile(join(repo, "main.txt"), "main\n", "utf8");
  await git(repo, ["add", "--", "main.txt"]);
  await git(repo, ["commit", "-m", "main"]);
  const mainOid = await git(repo, ["rev-parse", "HEAD"]);

  await git(repo, ["switch", "-c", "feature"]);
  await writeFile(join(repo, "feature.txt"), "feature\n", "utf8");
  await git(repo, ["add", "--", "feature.txt"]);
  await git(repo, ["commit", "-m", "feature"]);
  const featureOid = await git(repo, ["rev-parse", "HEAD"]);

  // PR探索がGitHub CLIへ進まないよう、ローカルのHEADだけをdetachedにする。
  await git(repo, ["switch", "--detach", featureOid]);
  return { featureOid, mainOid, repo };
}

async function savePassedFeatureSession(
  repo: string,
  mainOid: string,
  featureOid: string
): Promise<void> {
  const diff = await readRepositoryDiff({
    base: mainOid,
    head: featureOid,
    maxBytes: DEFAULT_CONFIG.analysis.maxDiffBytes,
    repoRoot: repo
  });
  let session = createSessionRecord(
    {
      base: mainOid,
      diffDigest: fingerprint(diff),
      head: featureOid,
      model: DEFAULT_CONFIG.model,
      policyDigest: createPolicyDigest(DEFAULT_CONFIG),
      promptVersion: PROMPT_VERSION,
      ref: `refs/heads/feature@${ZERO_OID}`,
      remote: "local"
    },
    NOW
  );
  session = transitionSession(session, "analyzed", NOW, {
    analysis: {
      attention: [],
      filesChanged: 1,
      findings: [],
      risks: [],
      summary: "feature変更"
    }
  });
  session = transitionSession(session, "review_resolved", NOW);
  session = transitionSession(session, "questioning", NOW);
  session = transitionSession(session, "passed", NOW);

  await new AtomicJsonSessionStore(join(repo, ".git", "sekisyo")).save(session);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("runPrePushHook", () => {
  test("複数refを順に検証し未通過の非current refで安全停止する", async () => {
    const { featureOid, mainOid, repo } = await createTwoCommitRepository();
    await savePassedFeatureSession(repo, mainOid, featureOid);
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-real";

    try {
      await expect(
        runPrePushHook({
          cwd: repo,
          remote: "local",
          stdin:
            `refs/heads/feature ${featureOid} ` +
            `refs/heads/feature ${ZERO_OID}\n` +
            `refs/heads/main ${mainOid} ` +
            `refs/heads/main ${ZERO_OID}\n`
        })
      ).rejects.toThrow("main は現在checkoutされておらず未通過です");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  }, 60_000);
});
