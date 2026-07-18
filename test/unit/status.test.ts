import { describe, expect, test } from "bun:test";
import { isCurrentSession } from "../../src/commands/status.ts";
import { PROMPT_VERSION } from "../../src/application/gate.ts";
import { createPolicyDigest, DEFAULT_CONFIG } from "../../src/config/index.ts";
import { fingerprint } from "../../src/domain/fingerprint.ts";
import { createSessionRecord } from "../../src/domain/session.ts";
import type { GateTarget } from "../../src/application/gate.ts";

const BASE_OID = "a".repeat(40);
const HEAD_OID = "b".repeat(40);
const OLD_REMOTE_OID = "c".repeat(40);
const NEW_REMOTE_OID = "d".repeat(40);
const DIFF = "diff";
const NOW = "2026-07-18T12:00:00.000Z";
const target: GateTarget = {
  analysisTarget: { kind: "base", baseRef: BASE_OID },
  base: BASE_OID,
  changedFiles: ["src/example.ts"],
  diff: DIFF,
  diffDigest: fingerprint(DIFF),
  head: HEAD_OID,
  policyDigest: createPolicyDigest(DEFAULT_CONFIG),
  ref: `refs/heads/feature@${NEW_REMOTE_OID}`,
  remote: "origin",
  repoRoot: "C:\\repo"
};
const session = createSessionRecord(
  {
    base: target.base,
    diffDigest: fingerprint(DIFF),
    head: target.head,
    model: DEFAULT_CONFIG.model,
    policyDigest: target.policyDigest,
    promptVersion: PROMPT_VERSION,
    ref: `refs/heads/feature@${OLD_REMOTE_OID}`,
    remote: target.remote
  },
  NOW
);

describe("Sekisyo status freshness", () => {
  test("push後にremote OIDが進んでも同じ宛先refとdiffならcurrentと判定する", () => {
    expect(
      isCurrentSession(session, DEFAULT_CONFIG, target, fingerprint(DIFF))
    ).toBeTrue();
  });

  test("diffまたはpolicyが変わった記録をstaleと判定する", () => {
    expect(
      isCurrentSession(
        session,
        DEFAULT_CONFIG,
        target,
        fingerprint("different diff")
      )
    ).toBeFalse();
    expect(
      isCurrentSession(
        session,
        DEFAULT_CONFIG,
        {
          ...target,
          policyDigest: fingerprint("different policy")
        },
        fingerprint(DIFF)
      )
    ).toBeFalse();
  });
});
