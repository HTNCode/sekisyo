import { createHash } from "node:crypto";

export interface SessionFingerprintInput {
  readonly base: string;
  readonly head: string;
  readonly remote: string;
  readonly ref: string;
  readonly policyDigest: string;
  readonly promptVersion: string;
  readonly model: string;
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeFingerprintPart(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, "utf8")}:${value}`;
}

export function createSessionFingerprint(
  input: SessionFingerprintInput
): string {
  const parts = [
    ["base", input.base],
    ["head", input.head],
    ["remote", input.remote],
    ["ref", input.ref],
    ["policyDigest", input.policyDigest],
    ["promptVersion", input.promptVersion],
    ["model", input.model]
  ] as const;

  return fingerprint(
    parts.map(([name, value]) => encodeFingerprintPart(name, value)).join("\n")
  );
}
