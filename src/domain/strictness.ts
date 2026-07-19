export const REVIEW_STRICTNESS_LEVELS = [
  "light",
  "standard",
  "strict"
] as const;

export type ReviewStrictness = (typeof REVIEW_STRICTNESS_LEVELS)[number];

export const DEFAULT_REVIEW_STRICTNESS: ReviewStrictness = "standard";
