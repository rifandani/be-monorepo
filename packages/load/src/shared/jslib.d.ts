// k6 fetches jslib modules by URL at run time, so they have no npm types.
declare module "https://jslib.k6.io/k6-summary/0.1.0/index.js" {
  /** One metric's end-of-test values, e.g. `{ avg, "p(95)", rate }`. */
  interface SummaryMetric {
    contains: string;
    type: string;
    values: Record<string, number>;
  }

  /** The end-of-test data k6 passes to `handleSummary`. */
  export interface SummaryData {
    metrics: Record<string, SummaryMetric>;
    root_group: unknown;
    state: unknown;
  }

  export const textSummary: (
    data: SummaryData,
    options?: { enableColors?: boolean; indent?: string }
  ) => string;
}
