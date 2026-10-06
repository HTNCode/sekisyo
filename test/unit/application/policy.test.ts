import { describe, expect, test } from "bun:test";
import {
  excludedDiffPaths,
  matchesGlob,
  matchesPrivacyGlob,
  resolveQuestionCategories
} from "../../../src/application/policy.ts";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.ts";
import { BUILT_IN_QUESTION_CATEGORIES } from "../../../src/domain/questions.ts";

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

  test("custom質問のrequiredを反映し、省略時はrequired=falseにする", () => {
    const config = {
      ...DEFAULT_CONFIG,
      questions: {
        ...DEFAULT_CONFIG.questions,
        custom: [
          { name: "ownership", prompt: "Explain the owner.", required: true },
          { name: "accessibility", prompt: "Explain keyboard behavior." }
        ]
      }
    };

    const categories = resolveQuestionCategories(config, analysis);

    expect(
      categories.find((category) => category.name === "ownership")
    ).toEqual({
      name: "ownership",
      prompt: "Explain the owner.",
      required: true
    });
    expect(
      categories.find((category) => category.name === "accessibility")
    ).toEqual({
      name: "accessibility",
      prompt: "Explain keyboard behavior.",
      required: false
    });
  });

  // gate.ts は「組み込みカテゴリは名前一致で検証し、それ以外はcustomとして
  // 件数で検証する」ため、policy が組み込みとして返す名前の集合が domain の
  // 定義と一致していることが前提になる。ずれると必須検証が静かに壊れる。
  test("policyが返す組み込みカテゴリ名はdomainの定義と一致する", () => {
    const builtInNames = resolveQuestionCategories(
      {
        ...DEFAULT_CONFIG,
        questions: {
          ...DEFAULT_CONFIG.questions,
          categories: {
            boundary: true,
            ripple: true,
            alternatives: true,
            failure: true,
            performance: true
          },
          custom: []
        }
      },
      analysis
    ).map((category) => category.name);

    expect(builtInNames.toSorted()).toEqual(
      [...BUILT_IN_QUESTION_CATEGORIES].toSorted()
    );
  });

  test("秘密パスは内容ではなくファイル名だけで検出する", () => {
    expect(matchesPrivacyGlob(".env.local", "**/.env*")).toBe(true);
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
      expect(matchesPrivacyGlob(path, pattern)).toBe(expected);
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

  test.each([
    [".ENV.production", "**/.env*"],
    ["src/Secrets/token.txt", "**/secrets/**"],
    ["certificates/CLIENT.PEM", "**/*.pem"],
    ["private/CLIENT.KEY", "**/*.key"]
  ])("privacy globは全OSで大小文字を区別しない: %s", (path, pattern) => {
    expect(matchesPrivacyGlob(path, pattern)).toBe(true);
    expect(excludedDiffPaths([path], [pattern])).toEqual([path]);
  });

  test("質問taxonomyの通常glob semanticsはprivacy matcherから独立している", () => {
    expect(matchesGlob("src/Billing/charge.ts", "src/billing/**")).toBe(
      process.platform === "win32"
    );
  });
});
