import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { messageOf } from "./message-of.ts";

describe(messageOf, () => {
  it("should give the message of an Error", () => {
    const cause = new Error("connection refused");

    const message = messageOf(cause);

    expect(message).toBe("connection refused");
  });

  it("should give the message of an Error subclass", () => {
    const cause = new TypeError("fetch failed");

    const message = messageOf(cause);

    expect(message).toBe("fetch failed");
  });

  it("should give the string form of a value that is not an Error", () => {
    const cause = { toString: () => "redis is down" };

    const message = messageOf(cause);

    expect(message).toBe("redis is down");
  });

  it("should give the string form of undefined and null", () => {
    expect([messageOf(undefined), messageOf(null)]).toStrictEqual([
      "undefined",
      "null",
    ]);
  });

  it("should always give the message of an Error, not its string form", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const cause = new Error(text);

        const message = messageOf(cause);

        expect(message).toBe(text);
      })
    );
  });

  it("should always give a string cause back with no change", () => {
    fc.assert(
      fc.property(fc.string(), (cause) => {
        const message = messageOf(cause);

        expect(message).toBe(cause);
      })
    );
  });
});
