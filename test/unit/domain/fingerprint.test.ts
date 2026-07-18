import { describe, expect, test } from "bun:test";
import {
  createSessionFingerprint,
  fingerprint,
  type SessionFingerprintInput
} from "../../../src/domain/fingerprint.ts";

const binding: SessionFingerprintInput = {
  base: "base",
  head: "head",
  remote: "origin",
  ref: "refs/heads/main",
  policyDigest: fingerprint("policy"),
  promptVersion: "v1",
  model: "gpt-5.6-sol"
};

describe("fingerprint", () => {
  test("SHA-256の既知ベクトルを返す", () => {
    expect(fingerprint("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  test("同じbindingには同じfingerprintを返す", () => {
    expect(createSessionFingerprint(binding)).toBe(
      createSessionFingerprint({ ...binding })
    );
  });

  test.each([
    ["base", "other"],
    ["head", "other"],
    ["remote", "upstream"],
    ["ref", "refs/heads/feature"],
    ["policyDigest", fingerprint("other")],
    ["promptVersion", "v2"],
    ["model", "gpt-5.6-terra"]
  ] as const)("%sの変更を区別する", (key, value) => {
    expect(createSessionFingerprint({ ...binding, [key]: value })).not.toBe(
      createSessionFingerprint(binding)
    );
  });

  test("値の連結位置が違うbindingを区別する", () => {
    const first = { ...binding, base: "a", head: "bc" };
    const second = { ...binding, base: "ab", head: "c" };
    expect(createSessionFingerprint(first)).not.toBe(
      createSessionFingerprint(second)
    );
  });
});
