import { describe, expect, test } from "bun:test";

import {
  configQaModelDescriptor,
  parseQaModelDescriptor,
  qaModelDescriptor,
  selectQaModel
} from "../../../src/config/model.ts";
import { createPolicyDigest, parseConfig } from "../../../src/config/parse.ts";

describe("provider と model の解決", () => {
  test("provider省略時はOpenAIで、記録上の識別子もモデル名だけのまま", () => {
    const config = parseConfig({ model: "gpt-5.6-sol" });
    expect(config.provider).toBeUndefined();
    expect(selectQaModel(config)).toEqual({
      provider: "openai",
      model: "gpt-5.6-sol"
    });
    expect(configQaModelDescriptor(config)).toBe("gpt-5.6-sol");
  });

  test("anthropicでmodelを省くとOpenAIのモデル名ではなく既定のClaudeを使う", () => {
    const config = parseConfig({ provider: "anthropic" });
    expect(config.model).toBe("claude-opus-5-5");
    expect(configQaModelDescriptor(config)).toBe("anthropic:claude-opus-5-5");
  });

  test.each(["google", "openai-compatible"])(
    "%s ではmodelの明示を求める",
    (provider) => {
      expect(() => parseConfig({ provider })).toThrow("model");
      expect(parseConfig({ provider, model: "some-model" }).model).toBe(
        "some-model"
      );
    }
  );

  test("接続先やキーはリポジトリの設定に書けない", () => {
    expect(() =>
      parseConfig({
        provider: "openai-compatible",
        model: "llama3",
        baseURL: "https://attacker.example/v1"
      })
    ).toThrow();
    expect(() =>
      parseConfig({ provider: "anthropic", apiKey: "sk-ant-xxx" })
    ).toThrow();
  });

  test("未知のproviderは拒否する", () => {
    expect(() => parseConfig({ provider: "unknown", model: "m" })).toThrow();
  });

  test("providerを変えると通過記録のdigestも変わる", () => {
    expect(createPolicyDigest(parseConfig({ provider: "anthropic" }))).not.toBe(
      createPolicyDigest(parseConfig({}))
    );
  });
});

describe("記録上のモデル識別子", () => {
  test.each([
    [{ provider: "openai" as const, model: "gpt-5.6-sol" }],
    [{ provider: "anthropic" as const, model: "claude-opus-5-5" }],
    [{ provider: "google" as const, model: "gemini-x" }],
    [{ provider: "openai-compatible" as const, model: "llama3:8b" }]
  ])("往復で元に戻る %o", (selection) => {
    expect(parseQaModelDescriptor(qaModelDescriptor(selection))).toEqual(
      selection
    );
  });

  test("既存記録のOpenAIモデル名は、コロンを含んでもOpenAIとして読む", () => {
    expect(parseQaModelDescriptor("ft:gpt-5:org:custom")).toEqual({
      provider: "openai",
      model: "ft:gpt-5:org:custom"
    });
  });
});
