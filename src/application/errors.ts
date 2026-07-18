export type GateErrorCode =
  | "fix_requested"
  | "follow_ups_exhausted"
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
