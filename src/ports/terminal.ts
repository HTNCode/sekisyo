export interface SelectOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly description?: string;
}

/**
 * 入力ストリームがEOFに達し、もう回答を受け取れないことを表す。
 * prompt / confirm / select は解決を待ち続けず、このエラーでrejectする。
 */
export class TerminalInputClosedError extends Error {
  public constructor(
    message = "端末の入力が終了したため、回答を受け取れません。"
  ) {
    super(message);
    this.name = "TerminalInputClosedError";
  }
}

export interface Terminal {
  write(message: string): void;
  error(message: string): void;
  /** @throws {TerminalInputClosedError} 入力がEOFに達した場合 */
  prompt(message: string): Promise<string>;
  /** @throws {TerminalInputClosedError} 入力がEOFに達した場合 */
  confirm(message: string): Promise<boolean>;
  /** @throws {TerminalInputClosedError} 入力がEOFに達した場合 */
  select<Value extends string>(
    message: string,
    options: readonly SelectOption<Value>[]
  ): Promise<Value>;
}
