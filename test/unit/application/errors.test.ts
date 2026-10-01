import { describe, expect, test } from "bun:test";
import {
  EXIT_CODE,
  exitCodeForError,
  GateError,
  type ExitCode,
  type GateErrorCode
} from "../../../src/application/errors.ts";
import { TerminalInputClosedError } from "../../../src/ports/terminal.ts";

const EXPECTED: Readonly<Record<GateErrorCode, ExitCode>> = {
  fix_requested: EXIT_CODE.cancelled,
  follow_ups_exhausted: EXIT_CODE.failure,
  interactive_input_closed: EXIT_CODE.environment,
  interactive_terminal_required: EXIT_CODE.environment,
  no_changes: EXIT_CODE.failure,
  privacy_exclusion: EXIT_CODE.configuration,
  review_reason_exhausted: EXIT_CODE.failure
};

describe("exitCodeForError", () => {
  test("終了コードの番号は公開インタフェースとして固定する", () => {
    expect(EXIT_CODE).toEqual({
      cancelled: 2,
      configuration: 4,
      environment: 3,
      failure: 1,
      success: 0
    });
  });

  test("GateErrorCode ごとの終了コードを固定する", () => {
    for (const [code, expected] of Object.entries(EXPECTED)) {
      expect(exitCodeForError(new GateError(code as GateErrorCode, code))).toBe(
        expected
      );
    }
  });

  test("ゲート外で起きた入力EOFもenvironmentへ寄せる", () => {
    expect(exitCodeForError(new TerminalInputClosedError())).toBe(
      EXIT_CODE.environment
    );
  });

  test("GateError以外の例外はfailureへ寄せる", () => {
    expect(exitCodeForError(new Error("想定外"))).toBe(EXIT_CODE.failure);
    expect(exitCodeForError("文字列")).toBe(EXIT_CODE.failure);
    expect(exitCodeForError(undefined)).toBe(EXIT_CODE.failure);
  });
});
