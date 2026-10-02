import type { ColorTarget } from "../ports/terminal.ts";

/**
 * モジュール読み込み時に一度だけ評価すると、pre-pushフックが別途開いた端末の
 * 判定を取り込めないため、呼び出しごとに出力先を見て判定する。
 */
export function supportsColor(target: ColorTarget = process.stdout): boolean {
  return target.isTTY === true && process.env.NO_COLOR === undefined;
}

function color(
  code: number,
  value: string,
  target: ColorTarget | undefined
): string {
  return supportsColor(target ?? process.stdout)
    ? `\u001B[${code}m${value}\u001B[0m`
    : value;
}

export function heading(value: string, target?: ColorTarget): string {
  return color(
    36,
    `── ${value} ${"─".repeat(Math.max(1, 48 - value.length))}`,
    target
  );
}

export function success(value: string, target?: ColorTarget): string {
  return color(32, value, target);
}

export function warning(value: string, target?: ColorTarget): string {
  return color(33, value, target);
}

export function muted(value: string, target?: ColorTarget): string {
  return color(90, value, target);
}
