import { configureGlobal } from "fast-check";

import { numRuns, registerReplayHint, seed } from "../vitest.property.ts";

configureGlobal({ numRuns, seed });

registerReplayHint();
