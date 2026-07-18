export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly body: string;
  readonly base: string;
  readonly baseOid: string;
  readonly head: string;
  readonly headRefName: string;
}

export interface PublishPullRequestInput {
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
}

export interface PublishedPullRequest {
  readonly number: number;
  readonly url: string;
}

export interface PrPublisher {
  findCurrent(repoRoot: string): Promise<PullRequest | undefined>;
  publish(input: PublishPullRequestInput): Promise<PublishedPullRequest>;
  updateBody(number: number, body: string): Promise<void>;
}
