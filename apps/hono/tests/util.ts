/**
 * Parse the Server-Timing header and return the total duration in seconds
 * @param header - The Server-Timing header
 * @returns The total duration in seconds
 * @example
 * const serverTiming = "total;dur=0.7;desc=\"Total Response Time\"";
 * const dur = parseServerTimingHeader(serverTiming);
 * console.log(dur); // 0.7
 */
export function parseServerTimingHeader(header: string | null): number | null {
  const m = header?.match(/total;dur=([\d.]+)/);
  return m ? Number(m[1]) : null;
}
