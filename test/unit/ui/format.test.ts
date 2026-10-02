import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  heading,
  muted,
  success,
  supportsColor,
  warning
} from "../../../src/ui/format.ts";

const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

// 開発環境に NO_COLOR が export されていても結果が変わらないよう、
// 色が付くことを期待するテストの前に必ず消す。見るテストだけが自分で設定する。
beforeEach(() => {
  delete process.env.NO_COLOR;
});

afterEach(() => {
  if (ORIGINAL_NO_COLOR === undefined) {
    delete process.env.NO_COLOR;
    return;
  }
  process.env.NO_COLOR = ORIGINAL_NO_COLOR;
});

describe("supportsColor", () => {
  test("色判定は渡された出力ストリームごとに決まる", () => {
    expect(supportsColor({ isTTY: true })).toBeTrue();
    expect(supportsColor({ isTTY: false })).toBeFalse();
    expect(supportsColor({})).toBeFalse();
  });

  test("NO_COLORは呼び出し時点の値が効く", () => {
    process.env.NO_COLOR = "1";

    expect(supportsColor({ isTTY: true })).toBeFalse();
  });
});

describe("装飾関数", () => {
  test("TTYな出力先にはANSIコードを付ける", () => {
    expect(success("通過", { isTTY: true })).toBe("\u001B[32m通過\u001B[0m");
    expect(warning("再確認", { isTTY: true })).toBe(
      "\u001B[33m再確認\u001B[0m"
    );
    expect(muted("ねらい", { isTTY: true })).toBe("\u001B[90mねらい\u001B[0m");
    expect(heading("通過", { isTTY: true })).toStartWith("\u001B[36m");
  });

  test("TTYでない出力先には素のテキストを返す", () => {
    expect(success("通過", { isTTY: false })).toBe("通過");
    expect(warning("再確認", {})).toBe("再確認");
    expect(muted("ねらい", { isTTY: false })).toBe("ねらい");
    expect(heading("通過", { isTTY: false })).not.toContain("\u001B[");
  });
});
