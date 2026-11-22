import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isContentfulStatusCode } from "./http-status.ts";

const CONTENTFUL_STATUS_CODES = [
  100, 102, 103, 200, 201, 202, 203, 206, 207, 208, 226, 300, 301, 302, 303,
  305, 306, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
  411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428,
  429, 431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
];

const CONTENTLESS_STATUS_CODES = [101, 204, 205, 304];

describe(isContentfulStatusCode, () => {
  it.each(CONTENTFUL_STATUS_CODES)(
    "should accept the contentful status %i",
    (status) => {
      const result = isContentfulStatusCode(status);

      expect(result).toBeTruthy();
    }
  );

  it.each(CONTENTLESS_STATUS_CODES)(
    "should reject the status %i that has no body",
    (status) => {
      const result = isContentfulStatusCode(status);

      expect(result).toBeFalsy();
    }
  );

  it.each([-1, 0, 199, 299, 420, 499, 509, 599, 600, 404.5, Number.NaN])(
    "should reject %d, which is not an official contentful status",
    (status) => {
      const result = isContentfulStatusCode(status);

      expect(result).toBeFalsy();
    }
  );

  it("should never accept a number outside the contentful status list", () => {
    const known = new Set(CONTENTFUL_STATUS_CODES);

    fc.assert(
      fc.property(
        fc
          .oneof(fc.integer(), fc.double())
          .filter((status) => !known.has(status)),
        (status) => {
          const result = isContentfulStatusCode(status);

          expect(result).toBeFalsy();
        }
      )
    );
  });
});
