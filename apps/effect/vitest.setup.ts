import { Arbitrary } from "effect";

import { numRuns, registerReplayHint, seed } from "../../vitest.property.ts";

Arbitrary.configureGlobal({ check: { runs: numRuns, seed } });

registerReplayHint();
