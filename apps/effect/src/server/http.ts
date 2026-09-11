import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { Api } from "#api/api.ts";

import type { Overrides } from "./chain.ts";
import { chain } from "./chain.ts";
import { Health } from "./health.ts";

/**
 * The routes, composed but not served. Both entrypoints hand this to
 * `HttpRouter.serve` with their own platform layer; the app test hands it to
 * `HttpRouter.toWebHandler`.
 *
 * Every new group needs its handler layer in the `Layer.provide` below. To
 * forget it is a runtime defect, not a type error.
 *
 * Takes `Overrides` so a test can substitute one entry of the Middleware Chain
 * without restating this composition — which is what keeps the routes served by
 * `tests/nesting.test.ts` the routes this app actually serves. The chain, and
 * what a short-circuited response carries out of it, is `chain.ts`.
 */
export const appWith = (overrides: Overrides) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api, { openapiPath: "/openapi" }).pipe(
      Layer.provide(Health.handlers.pipe(Layer.provide(Health.layer)))
    ),
    HttpApiScalar.layer(Api, { path: "/openapi/docs" }),
    chain(overrides)
  );

/** The app as it is served, with every entry of the chain as declared. */
export const app = appWith({});
