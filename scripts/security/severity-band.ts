export const LEVEL_RANK = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
} as const;

export type SeverityBand = keyof typeof LEVEL_RANK;

export const isSeverityBand = (value: string): value is SeverityBand =>
  Object.hasOwn(LEVEL_RANK, value);
