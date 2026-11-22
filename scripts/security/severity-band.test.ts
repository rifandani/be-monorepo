import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isSeverityBand } from "./severity-band.ts";

const SEVERITY_BANDS = ["low", "moderate", "high", "critical"];

describe(isSeverityBand, () => {
  it.each(SEVERITY_BANDS)("should accept the band %j", (value) => {
    const result = isSeverityBand(value);

    expect(result).toBeTruthy();
  });

  it.each([
    "",
    "medium",
    "HIGH",
    " high",
    "bogus",
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
  ])("should reject %j, which is not a band", (value) => {
    const result = isSeverityBand(value);

    expect(result).toBeFalsy();
  });

  it("should never accept a string outside the band list", () => {
    const known = new Set(SEVERITY_BANDS);

    fc.assert(
      fc.property(
        fc.string().filter((value) => !known.has(value)),
        (value) => {
          const result = isSeverityBand(value);

          expect(result).toBeFalsy();
        }
      )
    );
  });
});
