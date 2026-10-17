import { describe, expect, test } from "bun:test";
import {
  createPolicyDigest,
  parseConfig,
  parseConfigYaml,
  SEKISYO_CONFIG_TEMPLATE
} from "../../../src/config/parse.ts";

// 既存の .sekisyo.yml から作られた通過記録を、設定項目の追加だけで無効化しない
// ための固定値。値が変わるのは、利用者の設定を変えずに digest が動いたことを意味する。
const TEMPLATE_DIGEST =
  "c1c69f0f8114a903df4236fa1fd8d0bb9b46e3b89eab844335e4a0670022ec6c";
const ANALYSIS_MODEL_DIGEST =
  "db26c8d55c5f242630d7aa2a0f3b43983388bba78b3dda8e0f46e6b8da2dc9f9";

describe("policy digest の互換性", () => {
  test("テンプレートと空の設定は従来と同じ digest になる", () => {
    expect(createPolicyDigest(parseConfigYaml(SEKISYO_CONFIG_TEMPLATE))).toBe(
      TEMPLATE_DIGEST
    );
    expect(createPolicyDigest(parseConfig({}))).toBe(TEMPLATE_DIGEST);
  });

  test("analysis.model を指定した既存設定も従来と同じ digest になる", () => {
    expect(
      createPolicyDigest(
        parseConfig({
          model: "gpt-5.6-sol",
          analysis: { model: "gpt-5.5-codex" }
        })
      )
    ).toBe(ANALYSIS_MODEL_DIGEST);
  });
});

describe("triggers と policy digest", () => {
  test("commit 時の試問を切り替えても digest は変わらない", () => {
    expect(
      createPolicyDigest(parseConfig({ triggers: { commit: true } }))
    ).toBe(TEMPLATE_DIGEST);
    expect(
      createPolicyDigest(parseConfig({ triggers: { commit: false } }))
    ).toBe(TEMPLATE_DIGEST);
  });

  test("triggers に未知のキーは書けない", () => {
    expect(() => parseConfig({ triggers: { merge: true } })).toThrow();
  });
});
