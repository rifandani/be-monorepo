import { configureGlobal } from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { numRuns, registerReplayHint, seed } from "../../vitest.property.ts";

configureGlobal({ numRuns, seed });

registerReplayHint();

RuleTester.describe = (text, fn) => {
  describe(text, fn);
};

RuleTester.it = (text, fn) => {
  it(text, fn);
};
