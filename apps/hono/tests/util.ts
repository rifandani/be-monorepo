export const parseServerTimingHeader = (
  header: string | null
): number | null => {
  const m = header?.match(/total;dur=(?<dur>[\d.]+)/u);

  const duration = m?.groups?.dur;

  return duration !== undefined && duration.length > 0
    ? Number(duration)
    : null;
};
