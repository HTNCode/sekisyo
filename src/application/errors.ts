import { TerminalInputClosedError } from "../ports/terminal.ts";

export type GateErrorCode =
  | "fix_requested"
  | "follow_ups_exhausted"
  | "interactive_input_closed"
  | "interactive_terminal_required"
  | "no_changes"
  | "privacy_exclusion"
  | "review_reason_exhausted";

export class GateError extends Error {
  public constructor(
    public readonly code: GateErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GateError";
  }
}

/**
 * プロセスの終了コード。GateErrorCode を1:1で番号化すると、内部の分類を増減する
 * たびに公開インタフェースである終了コードが動くため、原因の種類で粗く分ける。
 */
export const EXIT_CODE = {
  /** 正常終了 */
  success: 0,
  /** 未通過、または一般的な失敗 */
  failure: 1,
  /** 利用者が中断した（確認の取り消し、修正のための中断） */
  cancelled: 2,
  /** 実行環境に起因する中断（対話端末がない、入力がEOFに達した） */
  environment: 3,
  /**
   * 設定・方針により差分を読まずに中断した。現在到達するのは privacy.exclude に
   * 一致するパスが差分に含まれる場合だけで、設定ファイル自体の不正は failure。
   */
  configuration: 4
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

const GATE_ERROR_EXIT_CODES: Readonly<Record<GateErrorCode, ExitCode>> = {
  fix_requested: EXIT_CODE.cancelled,
  follow_ups_exhausted: EXIT_CODE.failure,
  interactive_input_closed: EXIT_CODE.environment,
  interactive_terminal_required: EXIT_CODE.environment,
  no_changes: EXIT_CODE.failure,
  privacy_exclusion: EXIT_CODE.configuration,
  review_reason_exhausted: EXIT_CODE.failure
};

/**
 * GateError は code に対応する終了コードへ、それ以外の例外は failure へ寄せる。
 * 入力のEOFはゲートの外（clean の確認など）でも起きるため、GateError へ変換される
 * 経路と同じ environment に揃える。
 */
export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof GateError) {
    return GATE_ERROR_EXIT_CODES[error.code];
  }
  if (error instanceof TerminalInputClosedError) {
    return EXIT_CODE.environment;
  }
  return EXIT_CODE.failure;
}
