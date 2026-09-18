import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

const WHITE = "\u001B[37m";
const TIMESTAMP = /\[\d{2}:\d{2}:\d{2}\.\d{3}\]/u;

const CASES = [
  {
    color: "\u001B[32m",
    consoleMethod: "debug",
    method: "debug",
    severity: "DEBUG",
  },
  {
    color: "\u001B[31m",
    consoleMethod: "error",
    method: "error",
    severity: "ERROR",
  },
  {
    color: "\u001B[34m",
    consoleMethod: "log",
    method: "log",
    severity: "INFO",
  },
  {
    color: "\u001B[33m",
    consoleMethod: "warn",
    method: "warn",
    severity: "WARN",
  },
] as const;

describe.each(CASES)(
  "logger.$method",
  ({ color, consoleMethod, method, severity }) => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(`writes to console.${consoleMethod}`, () => {
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {
        // Swallow output so the test run stays readable.
      });

      logger[method]("something happened");

      expect(spy).toHaveBeenCalledOnce();
    });

    it("labels the line with its severity and colours", () => {
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {
        // Swallow output so the test run stays readable.
      });

      logger[method]("something happened");

      const line = spy.mock.calls[0]?.[0] as string;

      expect(line).toContain(`${color}${severity}: `);
      expect(line).toContain(`${WHITE}something happened`);
      expect(line.startsWith(color)).toBeTruthy();
    });

    it("stamps the line with a zero-padded time to millisecond precision", () => {
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {
        // Swallow output so the test run stays readable.
      });

      logger[method]("something happened");

      expect(spy.mock.calls[0]?.[0] as string).toMatch(TIMESTAMP);
    });

    it("forwards extra attributes to console untouched", () => {
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {
        // Swallow output so the test run stays readable.
      });
      const attribute = { requestId: "abc" };

      logger[method]("something happened", attribute, 42);

      expect(spy.mock.calls[0]?.slice(1)).toStrictEqual([attribute, 42]);
    });
  }
);

describe("logger severity colours", () => {
  it("gives every level a distinct colour", () => {
    const colors = CASES.map((testCase) => testCase.color);

    expect(new Set(colors).size).toBe(CASES.length);
  });
});
