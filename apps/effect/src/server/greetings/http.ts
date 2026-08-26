import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { Api } from "../../api/api.js";
import { Greetings } from "../greetings.js";

/**
 * The handlers with their dependencies still open, so a test can supply a
 * different `Greetings` implementation.
 */
export const greetingsHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "greetings",
  Effect.fn(function* makeGreetingsHandlers(handlers) {
    const greetings = yield* Greetings;

    return handlers.handleAll({
      hello: () => greetings.hello(),
    });
  })
);

/** The handlers ready to serve: what `server/http.ts` mounts. */
export const greetingsHandlers = greetingsHandlersNoDeps.pipe(
  Layer.provide(Greetings.layer)
);
