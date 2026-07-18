export interface SelectOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly description?: string;
}

export interface Terminal {
  write(message: string): void;
  error(message: string): void;
  prompt(message: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  select<Value extends string>(
    message: string,
    options: readonly SelectOption<Value>[]
  ): Promise<Value>;
}
