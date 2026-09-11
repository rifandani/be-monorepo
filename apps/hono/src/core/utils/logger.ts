// Moved verbatim from the dissolved `@workspace/core` package, where `DbStore` was
// its only caller. That call site moved to evlog's `log` (one logging vocabulary
// with `node.ts`), so nothing in production reaches this any more — only its own
// test does, which is why `fallow dead-code` stays quiet without a suppression.
// Kept, not deleted, on the same basis as the rest of the move.

const COLOR = {
  BLUE: "\u001B[34m",
  GREEN: "\u001B[32m",
  RED: "\u001B[31m",
  WHITE: "\u001B[37m",
  YELLOW: "\u001B[33m",
};

const LEVEL_COLORS = {
  DEBUG: COLOR.GREEN,
  ERROR: COLOR.RED,
  INFO: COLOR.BLUE,
  TRACE: COLOR.WHITE,
  WARN: COLOR.YELLOW,
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString("en-US", {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });

export const logger = {
  // oxlint-disable-next-line typescript/no-explicit-any
  debug(message: string, ...attributes: any[]) {
    const severity = "DEBUG";
    const severityColor = LEVEL_COLORS[severity];
    const timeFormatted = formatTime(new Date());

    console.debug(
      `${severityColor}[${timeFormatted}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`,
      ...attributes
    );
  },

  // oxlint-disable-next-line typescript/no-explicit-any
  error(message: string, ...attributes: any[]) {
    const severity = "ERROR";
    const severityColor = LEVEL_COLORS[severity];
    const timeFormatted = formatTime(new Date());

    console.error(
      `${severityColor}[${timeFormatted}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`,
      ...attributes
    );
  },

  // oxlint-disable-next-line typescript/no-explicit-any
  log(message: string, ...attributes: any[]) {
    const severity = "INFO";
    const severityColor = LEVEL_COLORS[severity];
    const timeFormatted = formatTime(new Date());

    console.log(
      `${severityColor}[${timeFormatted}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`,
      ...attributes
    );
  },

  // oxlint-disable-next-line typescript/no-explicit-any
  warn(message: string, ...attributes: any[]) {
    const severity = "WARN";
    const severityColor = LEVEL_COLORS[severity];
    const timeFormatted = formatTime(new Date());

    console.warn(
      `${severityColor}[${timeFormatted}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`,
      ...attributes
    );
  },
};
