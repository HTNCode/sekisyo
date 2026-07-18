import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const verifierPath = join(
  repoRoot,
  ".github",
  "scripts",
  "verify-sekisyo-record.cjs"
);
const workflowPath = join(
  repoRoot,
  ".github",
  "workflows",
  "sekisyo-record.yml"
);
const START_MARKER = "<!-- sekisyo:start:v1 -->";
const END_MARKER = "<!-- sekisyo:end -->";
const HEAD_OID = "a".repeat(40);
const OTHER_HEAD_OID = "b".repeat(40);
const HEAD_LINE = `**対象HEAD:** \`${HEAD_OID}\``;

interface VerificationResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

function blockWithHead(headLine: string = HEAD_LINE): string {
  return `${START_MARKER}
## Sekisyo 通過記録

${headLine}

record
${END_MARKER}`;
}

async function runVerifier(
  body: string,
  head: string = HEAD_OID
): Promise<VerificationResult> {
  const eventPath = join(tmpdir(), `sekisyo-record-event-${randomUUID()}.json`);
  await Bun.write(
    eventPath,
    JSON.stringify({ pull_request: { body, head: { sha: head } } })
  );

  try {
    const child = Bun.spawn(["node", verifierPath], {
      env: { ...process.env, EVENT_PATH: eventPath },
      stderr: "pipe",
      stdout: "pipe"
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text()
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    await unlink(eventPath);
  }
}

describe("Sekisyo record workflow verifier", () => {
  test("単一block内のHEADがPR head SHAと一致すれば通過する", async () => {
    const result = await runVerifier(`Existing body\n\n${blockWithHead()}`);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test.each([
    [
      "markerの順序が逆",
      `${END_MARKER}\n${HEAD_LINE}\n${START_MARKER}`,
      "order"
    ],
    ["blockが複数", `${blockWithHead()}\n${blockWithHead()}`, "exactly one"],
    [
      "markerが単独行ではない",
      `prefix ${START_MARKER}\n${HEAD_LINE}\n${END_MARKER}`,
      "standalone"
    ],
    [
      "HEAD行がblock外",
      `${HEAD_LINE}\n${START_MARKER}\nrecord\n${END_MARKER}`,
      "inside"
    ],
    [
      "HEAD行が複数",
      blockWithHead(`${HEAD_LINE}\n${HEAD_LINE}`),
      "exactly one"
    ],
    [
      "HEADがPR headと不一致",
      blockWithHead(`**対象HEAD:** \`${OTHER_HEAD_OID}\``),
      "does not match"
    ]
  ])("%sの場合は失敗する", async (_label, body, message) => {
    const result = await runVerifier(body);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  test("workflowは信頼済みbase SHAの検証スクリプトを実行する", async () => {
    const workflow = await Bun.file(workflowPath).text();

    expect(workflow).toContain(
      "ref: ${{ github.event.pull_request.base.sha }}"
    );
    expect(workflow).toContain(
      "node .github/scripts/verify-sekisyo-record.cjs"
    );

    const actions = [...workflow.matchAll(/^\s*uses:\s*(\S+)(?:\s|$)/gmu)].map(
      (match) => match[1]
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
    }
  });
});
