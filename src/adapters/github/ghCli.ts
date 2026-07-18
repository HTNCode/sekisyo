import { z } from "zod";
import type {
  PrPublisher,
  PublishedPullRequest,
  PublishPullRequestInput,
  PullRequest
} from "../../ports/pr-publisher.ts";
import {
  CommandError,
  runCommand,
  type CommandExecutor,
  type CommandResult
} from "../git/command.ts";

const COMMAND_TIMEOUT_MS = 60_000;
const gitObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i);
const pullRequestSchema = z.object({
  baseRefName: z.string().min(1),
  baseRefOid: gitObjectIdSchema,
  body: z.string(),
  headRefName: z.string().min(1),
  headRefOid: gitObjectIdSchema,
  number: z.number().int().positive(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  url: z.url()
});
const pullRequestListSchema = z.array(pullRequestSchema);

export type PullRequestDetails = z.infer<typeof pullRequestSchema>;

function assertText(value: string, label: string): string {
  const text = value.trim();
  if (text.length === 0 || text.includes("\0")) {
    throw new Error(`${label} must not be empty or contain NUL.`);
  }
  return text;
}

function toPullRequest(value: PullRequestDetails): PullRequest {
  return {
    number: value.number,
    url: value.url,
    state: value.state.toLowerCase() as PullRequest["state"],
    body: value.body,
    base: value.baseRefName,
    baseOid: value.baseRefOid,
    head: value.headRefOid,
    headRefName: value.headRefName
  };
}

async function runGh(
  repoRoot: string,
  args: readonly string[],
  stdin?: string,
  execute: CommandExecutor = runCommand
): Promise<CommandResult> {
  const command = ["gh", ...args];
  const result = await execute(command, {
    cwd: repoRoot,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: COMMAND_TIMEOUT_MS
  });
  if (result.exitCode !== 0) {
    throw new CommandError(
      `gh exited with code ${result.exitCode}.`,
      command,
      result
    );
  }
  return result;
}

async function currentBranch(
  repoRoot: string,
  execute: CommandExecutor = runCommand
): Promise<string | undefined> {
  const result = await execute(
    ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd: repoRoot, timeoutMs: COMMAND_TIMEOUT_MS }
  );
  if (result.exitCode !== 0) {
    return undefined;
  }
  const branch = result.stdout.trim();
  return branch.length === 0 ? undefined : branch;
}

export async function viewCurrentPullRequest(
  repoRoot: string
): Promise<PullRequestDetails> {
  const result = await runGh(repoRoot, [
    "pr",
    "view",
    "--json=number,url,state,body,headRefOid,headRefName,baseRefOid,baseRefName"
  ]);
  return pullRequestSchema.parse(JSON.parse(result.stdout));
}

export async function updatePullRequestBody(
  repoRoot: string,
  number: number,
  body: string,
  execute: CommandExecutor = runCommand
): Promise<void> {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Pull request number must be a positive integer.");
  }
  await runGh(
    repoRoot,
    ["pr", "edit", String(number), "--body-file=-"],
    body,
    execute
  );
}

export async function createPullRequest(
  input: {
    readonly base: string;
    readonly body: string;
    readonly head: string;
    readonly repoRoot: string;
    readonly title: string;
  },
  execute: CommandExecutor = runCommand
): Promise<string> {
  const base = assertText(input.base, "Base branch");
  const head = assertText(input.head, "Head branch");
  const title = assertText(input.title, "Pull request title");
  const result = await runGh(
    input.repoRoot,
    [
      "pr",
      "create",
      `--base=${base}`,
      `--head=${head}`,
      `--title=${title}`,
      "--body-file=-"
    ],
    input.body,
    execute
  );
  const match = result.stdout.match(/https?:\/\/\S+\/pull\/\d+/);
  if (match === null) {
    throw new Error("gh did not return the created pull request URL.");
  }
  return z.url().parse(match[0]);
}

export class GhCliPrPublisher implements PrPublisher {
  readonly #execute: CommandExecutor;
  readonly #repoRoot: string;

  public constructor(repoRoot: string, execute: CommandExecutor = runCommand) {
    this.#repoRoot = assertText(repoRoot, "Repository root");
    this.#execute = execute;
  }

  public async findCurrent(
    _repoRoot: string
  ): Promise<PullRequest | undefined> {
    const branch = await currentBranch(this.#repoRoot, this.#execute);
    if (branch === undefined) {
      return undefined;
    }
    const result = await this.#execute(
      [
        "gh",
        "pr",
        "list",
        `--head=${branch}`,
        "--state=open",
        "--limit=1",
        "--json=number,url,state,body,headRefOid,headRefName,baseRefOid,baseRefName"
      ],
      { cwd: this.#repoRoot, timeoutMs: COMMAND_TIMEOUT_MS }
    );
    if (result.exitCode !== 0) {
      throw new CommandError(
        `gh exited with code ${result.exitCode}.`,
        ["gh", "pr", "list"],
        result
      );
    }
    const pullRequests = pullRequestListSchema.parse(JSON.parse(result.stdout));
    const current = pullRequests[0];
    return current === undefined ? undefined : toPullRequest(current);
  }

  public async publish(
    input: PublishPullRequestInput
  ): Promise<PublishedPullRequest> {
    const url = await createPullRequest(
      {
        ...input,
        repoRoot: this.#repoRoot
      },
      this.#execute
    );
    const numberText = new URL(url).pathname.match(/\/pull\/(\d+)\/?$/)?.[1];
    const number = Number(numberText);
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error("Unable to parse the created pull request number.");
    }
    return { number, url };
  }

  public updateBody(number: number, body: string): Promise<void> {
    return updatePullRequestBody(this.#repoRoot, number, body, this.#execute);
  }
}

export function createPrPublisher(repoRoot: string): GhCliPrPublisher {
  return new GhCliPrPublisher(repoRoot);
}
