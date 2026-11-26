export type FailureClass = "refusal" | "fault" | "defect";

const REFUSAL_MIN = 400;
const REFUSAL_MAX = 499;
const FAULT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export const failureClass = (status: number): FailureClass => {
  if (status >= REFUSAL_MIN && status <= REFUSAL_MAX) {
    return "refusal";
  }

  return FAULT_STATUSES.has(status) ? "fault" : "defect";
};

export type FailureKind = "timeout" | "rejected" | "upstream" | "defect";

const SERVER_ERROR_MIN = 500;

const FAILURE_KINDS: ReadonlyMap<number, FailureKind> = new Map([
  [502, "upstream"],
  [503, "rejected"],
  [504, "timeout"],
]);

export const failureKind = (status: number): FailureKind | undefined => {
  if (status < SERVER_ERROR_MIN) {
    return undefined;
  }

  return FAILURE_KINDS.get(status) ?? "defect";
};
