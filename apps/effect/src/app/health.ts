import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { Health } from "#features/health/service.ts";

import { Api } from "./api.ts";

/** Bind the health feature to the complete API, with its service still open. */
export const healthHandlers = HttpApiBuilder.group(
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
