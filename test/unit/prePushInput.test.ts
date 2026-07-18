import { describe, expect, test } from "bun:test";
import {
  parsePrePushInput,
  shouldAssessUpdate
} from "../../src/hook/prePushInput.ts";

const SHA_ONE = "1".repeat(40);
const SHA_TWO = "2".repeat(40);
const ZERO_SHA = "0".repeat(40);
const SHA_256 = "a".repeat(64);
const ZERO_SHA_256 = "0".repeat(64);

describe("parsePrePushInput", () => {
  test("parses multiple branch updates", () => {
    const result = parsePrePushInput(
      `refs/heads/one ${SHA_ONE} refs/heads/one ${ZERO_SHA}\n` +
        `refs/heads/two ${SHA_TWO} refs/heads/two ${SHA_ONE}\n`
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.remoteOid).toBe(ZERO_SHA);
  });

  test("accepts deletion records and skips their assessment", () => {
    const [update] = parsePrePushInput(
      `(delete) ${ZERO_SHA} refs/heads/old ${SHA_ONE}\n`
    );

    expect(update).toBeDefined();
    expect(shouldAssessUpdate(update!)).toBeFalse();
  });

  test("rejects malformed input", () => {
    expect(() => parsePrePushInput("refs/heads/main not-a-sha")).toThrow();
  });

  test("skips tag updates", () => {
    const [update] = parsePrePushInput(
      `refs/tags/v1 ${SHA_ONE} refs/tags/v1 ${ZERO_SHA}\n`
    );

    expect(update).toBeDefined();
    expect(shouldAssessUpdate(update!)).toBeFalse();
  });

  test("assesses a tag or revision source pushed to a branch", () => {
    const [tagUpdate] = parsePrePushInput(
      `refs/tags/v1 ${SHA_ONE} refs/heads/release ${ZERO_SHA}\n`
    );
    const [revisionUpdate] = parsePrePushInput(
      `HEAD~2 ${SHA_TWO} refs/heads/recovery ${ZERO_SHA}\n`
    );

    expect(shouldAssessUpdate(tagUpdate!)).toBeTrue();
    expect(shouldAssessUpdate(revisionUpdate!)).toBeTrue();
  });

  test("accepts SHA-256 object IDs", () => {
    const [update] = parsePrePushInput(
      `refs/heads/main ${SHA_256} refs/heads/main ${ZERO_SHA_256}\n`
    );

    expect(update?.localOid).toBe(SHA_256);
    expect(shouldAssessUpdate(update!)).toBeTrue();
  });

  test("rejects zero object IDs with an invalid length", () => {
    expect(() =>
      parsePrePushInput(
        `refs/heads/main ${SHA_ONE} refs/heads/main ${"0".repeat(41)}\n`
      )
    ).toThrow("Invalid remote object ID");
  });
});
