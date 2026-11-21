declare module "https://jslib.k6.io/k6-summary/0.1.0/index.js" {
  interface SummaryMetric {
    contains: string;
    type: string;
    values: Record<string, number>;
  }

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
