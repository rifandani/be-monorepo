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
