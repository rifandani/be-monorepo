import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { Api } from "#api/api.ts";
import { Health } from "#server/health.ts";

/**
 * The handlers with their dependencies still open, so a test can supply a
 * `Health` whose readiness checks fail — which this app, depending on nothing,
 * cannot otherwise produce.
 */
export const healthHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "health",
  Effect.fn(function* makeHealthHandlers(handlers) {
    const health = yield* Health;

    return handlers.handleAll({
      startup: () => health.startup(),
      live: () => health.live(),
      ready: () => health.ready(),
    });
  })
);

/** The handlers ready to serve: what `server/http.ts` mounts. */
export const healthHandlers = healthHandlersNoDeps.pipe(
  Layer.provide(Health.layer)
);
