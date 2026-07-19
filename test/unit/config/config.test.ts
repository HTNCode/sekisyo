import { describe, expect, test } from "bun:test";
import {
  createPolicyDigest,
  DEFAULT_CONFIG,
  parseConfig,
  parseConfigYaml,
  SEKISYO_CONFIG_TEMPLATE
} from "../../../src/config/index.ts";

describe("Sekisyo config", () => {
  test("公開テンプレートをデフォルト設定として解析する", () => {
    expect(parseConfigYaml(SEKISYO_CONFIG_TEMPLATE)).toEqual(DEFAULT_CONFIG);
  });

  test("required、custom、path overrideを受け付ける", () => {
    const config = parseConfigYaml(`
version: 1
questions:
  categories:
    boundary: required
    ripple: false
    alternatives: false
    failure: false
    performance: false
  custom:
    - name: ownership
      prompt: Explain the owner.
  paths:
    "src/security/**":
      categories:
        failure: required
`);
    expect(config.questions.categories.boundary).toBe("required");
    expect(config.questions.custom[0]?.name).toBe("ownership");
    expect(config.questions.paths["src/security/**"]?.categories.failure).toBe(
      "required"
    );
  });

  test.each(["light", "standard", "strict"] as const)(
    "strictness=%sを受け付ける",
    (strictness) => {
      expect(parseConfig({ strictness }).strictness).toBe(strictness);
    }
  );

  test("strictness省略時はstandardになる", () => {
    expect(parseConfig({}).strictness).toBe("standard");
  });

  test("未知のstrictnessを拒否する", () => {
    expect(() => parseConfig({ strictness: "extreme" })).toThrow();
  });

  test("strictnessの変更でpolicy digestが変わる", () => {
    expect(createPolicyDigest(parseConfig({ strictness: "light" }))).not.toBe(
      createPolicyDigest(parseConfig({ strictness: "strict" }))
    );
  });

  test("質問源が空の設定を拒否する", () => {
    expect(() =>
      parseConfig({
        questions: {
          categories: {
            boundary: false,
            ripple: false,
            alternatives: false,
            failure: false,
            performance: false
          }
        }
      })
    ).toThrow("Enable a question category");
  });

  test("未知フィールドを拒否する", () => {
    expect(() => parseConfig({ apiKey: "must-not-be-configured" })).toThrow();
  });

  test("正規化後の設定から安定したpolicy digestを作る", () => {
    const first = parseConfig({});
    const second = parseConfig({ version: 1 });
    expect(createPolicyDigest(first)).toBe(createPolicyDigest(second));
  });
});
