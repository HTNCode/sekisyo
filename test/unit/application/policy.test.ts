import { describe, expect, test } from "bun:test";
import {
  excludedDiffPaths,
  matchesGlob,
  resolveQuestionCategories
} from "../../../src/application/policy.ts";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.ts";

const analysis = {
  attention: [],
  filesChanged: 1,
  findings: [],
  risks: [],
  summary: "変更"
};

describe("question policy", () => {
  test("changedFilesに一致したpath overrideをrequiredとして重ねる", () => {
    const config = {
      ...DEFAULT_CONFIG,
      questions: {
        ...DEFAULT_CONFIG.questions,
        paths: {
          "src/billing/**": {
            categories: { failure: "required" as const }
          }
        }
      }
    };

    const categories = resolveQuestionCategories(config, analysis, [
      "src/billing/charge.ts"
    ]);

    expect(categories.find((category) => category.name === "failure")).toEqual({
      name: "failure",
      required: true
    });
  });

  test("秘密パスは内容ではなくファイル名だけで検出する", () => {
    expect(matchesGlob(".env.local", "**/.env*")).toBe(true);
    expect(
      excludedDiffPaths(
        ["src/index.ts", "secrets/token.txt", ".env.local"],
        ["**/.env*", "**/secrets/**"]
      )
    ).toEqual(["secrets/token.txt", ".env.local"]);
  });

  test.each([
    [".env", "**/.env*", true],
    ["nested/.env.production", "**/.env*", true],
    ["src\\secrets\\token.txt", "**/secrets/**", true],
    ["certificates/client.pem", "**/*.pem", true],
    ["private/client.key", "**/*.key", true],
    ["src/secret/token.txt", "**/secrets/**", false],
    ["config/app.env", "**/.env*", false],
    ["public/key.txt", "**/*.key", false]
  ])(
    "privacy globはパス区切りを正規化して近似名を誤検出しない: %s",
    (path, pattern, expected) => {
      expect(matchesGlob(path, pattern)).toBe(expected);
    }
  );

  test("除外パスは入力順を保ち重複ファイルを一度だけ返す", () => {
    expect(
      excludedDiffPaths(
        [
          "src/index.ts",
          ".env",
          "src\\secrets\\token.txt",
          ".env",
          "src/index.ts"
        ],
        ["**/.env*", "**/secrets/**"]
      )
    ).toEqual([".env", "src\\secrets\\token.txt"]);
  });

  test("privacy globはWindowsの大小文字を区別しない", () => {
    expect(matchesGlob(".ENV.production", "**/.env*")).toBe(
      process.platform === "win32"
    );
    expect(matchesGlob("src/Secrets/token.txt", "**/secrets/**")).toBe(
      process.platform === "win32"
    );
  });
});
