const supportsColor =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function color(code: number, value: string): string {
  return supportsColor ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export function heading(value: string): string {
  return color(36, `── ${value} ${"─".repeat(Math.max(1, 48 - value.length))}`);
}

export function success(value: string): string {
  return color(32, value);
}

export function warning(value: string): string {
  return color(33, value);
}

export function muted(value: string): string {
  return color(90, value);
}
