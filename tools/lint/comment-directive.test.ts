import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isDirective } from "./comment-directive.ts";

describe(isDirective, () => {
  it.each([
    " oxlint-disable-next-line anti-slop/no-unknown-parameters",
    " @ts-expect-error -- the global is deleted on purpose",
    " fallow-ignore-next-line unused-export",
    '/ <reference types="node" />',
    "* @type {import('@stryker-mutator/api/core').PartialStrykerOptions} ",
    " Stryker disable next-line all",
    " SAFETY: the `in` check confirmed the key",
    "* SAFETY: JSON.parse returns any, and each field is checked below ",
  ])("should keep the tool directive %j", (value) => {
    const comment = { type: "Line", value } as const;

    const result = isDirective(comment);

    expect(result).toBeTruthy();
  });

  it("should keep a shebang", () => {
    const comment = { type: "Shebang", value: "/usr/bin/env node" } as const;

    const result = isDirective(comment);

    expect(result).toBeTruthy();
  });

  it.each([
    " Arrange",
    " 15 seconds",
    " SAFETY:",
    " SAFETY note without a colon",
    " the cast is fine. SAFETY: checked above",
    "* @public ",
  ])("should treat the prose %j as a comment", (value) => {
    const comment = { type: "Block", value } as const;

    const result = isDirective(comment);

    expect(result).toBeFalsy();
  });

  it("should always keep a comment that starts with a directive", () => {
    fc.assert(
      fc.property(fc.string(), (rest) => {
        const comment = {
          type: "Line",
          value: ` oxlint-disable${rest}`,
        } as const;

        const result = isDirective(comment);

        expect(result).toBeTruthy();
      })
    );
  });

  it("should never keep a comment that starts with prose", () => {
    fc.assert(
      fc.property(fc.string(), (rest) => {
        const comment = { type: "Block", value: ` Note${rest}` } as const;

        const result = isDirective(comment);

        expect(result).toBeFalsy();
      })
    );
  });
});
