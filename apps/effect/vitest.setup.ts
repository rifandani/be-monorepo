import { Arbitrary } from "effect";

import { numRuns, registerReplayHint, seed } from "../../vitest.property.ts";

// Property tests in this app use the Effect `Arbitrary` engine, through
// `it.prop` and `it.effect.prop` of `@effect/vitest`. It is not fast-check, so
// it has its own global options. The budget and the seed are shared with
// `apps/hono`; see `vitest.property.ts`.
Arbitrary.configureGlobal({ check: { runs: numRuns, seed } });

registerReplayHint();
