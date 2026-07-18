import type { SekisyoConfig } from "./schema.ts";

export const DEFAULT_CONFIG: SekisyoConfig = {
  version: 1,
  model: "gpt-5.6-sol",
  questions: {
    count: 3,
    maxFollowUps: 2,
    categories: {
      boundary: true,
      ripple: true,
      alternatives: true,
      failure: true,
      performance: false
    },
    custom: [],
    paths: {}
  },
  analysis: {
    maxChangedFiles: 200,
    maxDiffBytes: 1_000_000,
    timeoutSeconds: 180
  },
  privacy: {
    exclude: ["**/.env*", "**/secrets/**", "**/*.pem", "**/*.key"]
  }
};
