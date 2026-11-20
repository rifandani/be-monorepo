import { configureGlobal } from "fast-check";

import { numRuns, registerReplayHint, seed } from "../../vitest.property.ts";

// Property tests in this app use fast-check (`fc.assert`). The budget
// and the seed are shared with `apps/effect`; see `vitest.property.ts`.
// Shrinking stays on: a small counterexample is the most useful output.
configureGlobal({ numRuns, seed });

registerReplayHint();
