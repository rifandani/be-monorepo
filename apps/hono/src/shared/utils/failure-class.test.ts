import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { failureClass } from "./failure-class.ts";

describe(failureClass, () => {
  it("should call a rejected request a refusal", () => {
    const result = failureClass(422);

    expect(result).toBe("refusal");
  });

  it.each([502, 503, 504])(
    "should call the dependency status %i an infrastructure fault",
    (status) => {
      const result = failureClass(status);

      expect(result).toBe("fault");
    }
  );

  it("should call an internal server error a defect", () => {
    const result = failureClass(500);

    expect(result).toBe("defect");
  });

  it("should call a status that is not an error status a defect", () => {
    const result = failureClass(204);

    expect(result).toBe("defect");
  });

  it("should always call a 4xx status a refusal", () => {
    fc.assert(
      fc.property(fc.integer({ max: 499, min: 400 }), (status) => {
        const result = failureClass(status);

        expect(result).toBe("refusal");
      })
    );
  });

  it("should never call a status outside 400 to 504 anything but a defect", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ max: 399 }), fc.integer({ min: 505 })),
        (status) => {
          const result = failureClass(status);

          expect(result).toBe("defect");
        }
      )
    );
  });
});
