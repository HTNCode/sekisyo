import { describe, expect, test } from "bun:test";
import { GhCliPrPublisher } from "../../src/adapters/github/ghCli.ts";
import type {
  CommandExecutor,
  CommandResult
} from "../../src/adapters/git/command.ts";

const SUCCESS: CommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: ""
};

describe("GhCliPrPublisher", () => {
  test("returns undefined when the current branch has no open PR", async () => {
    const execute: CommandExecutor = async (command) => {
      return command[0] === "git"
        ? { ...SUCCESS, stdout: "feature\n" }
        : { ...SUCCESS, stdout: "[]\n" };
    };
    const publisher = new GhCliPrPublisher("C:\\repo", execute);

    expect(await publisher.findCurrent("ignored")).toBeUndefined();
  });

  test("maps current PR data and its head OID", async () => {
    const execute: CommandExecutor = async (command) => {
      if (command[0] === "git") {
        return { ...SUCCESS, stdout: "feature\n" };
      }
      return {
        ...SUCCESS,
        stdout: JSON.stringify([
          {
            baseRefName: "main",
            baseRefOid: "b".repeat(40),
            body: "Existing",
            headRefName: "feature",
            headRefOid: "a".repeat(40),
            number: 12,
            state: "OPEN",
            url: "https://github.com/HTNCode/sekisyo/pull/12"
          }
        ])
      };
    };
    const publisher = new GhCliPrPublisher("C:\\repo", execute);

    expect(await publisher.findCurrent("ignored")).toEqual({
      number: 12,
      url: "https://github.com/HTNCode/sekisyo/pull/12",
      state: "open",
      body: "Existing",
      base: "main",
      baseOid: "b".repeat(40),
      head: "a".repeat(40),
      headRefName: "feature"
    });
  });

  test("creates and updates PRs with argv and stdin, without a shell", async () => {
    const calls: Array<{
      readonly command: readonly string[];
      readonly stdin: string | undefined;
    }> = [];
    const execute: CommandExecutor = async (command, options) => {
      calls.push({ command, stdin: options.stdin });
      return command.includes("create")
        ? {
            ...SUCCESS,
            stdout: "https://github.com/HTNCode/sekisyo/pull/42\n"
          }
        : SUCCESS;
    };
    const publisher = new GhCliPrPublisher("C:\\repo", execute);

    expect(
      await publisher.publish({
        base: "main",
        head: "feature",
        title: "Add gate",
        body: "record"
      })
    ).toEqual({
      number: 42,
      url: "https://github.com/HTNCode/sekisyo/pull/42"
    });
    await publisher.updateBody(42, "updated");

    expect(calls[0]?.command).toContain("--head=feature");
    expect(calls[0]?.stdin).toBe("record");
    expect(calls[1]?.command).toEqual([
      "gh",
      "pr",
      "edit",
      "42",
      "--body-file=-"
    ]);
    expect(calls[1]?.stdin).toBe("updated");
  });
});
