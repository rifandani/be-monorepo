import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { Api } from "../api/api.js";
import { cors } from "./cors.js";
import { csrf } from "./csrf.js";
import { greetingsHandlers } from "./greetings/http.js";
import { language } from "./language.js";
import { requestId } from "./request-id.js";
import { secureHeaders } from "./secure-headers.js";
import { timeout } from "./timeout.js";
import { timing } from "./timing.js";

/**
 * The global middleware, outermost first.
 *
 * `Layer.flatMap` and not `Layer.mergeAll`: a global middleware registers when
 * its layer builds, `mergeAll` builds its members concurrently, and the
 * registration order is the nesting order — so `mergeAll` would leave the
 * nesting to whichever layer won the race. This is the order `apps/hono` mounts
 * the same seven in (`src/app.ts`), and the `flatMap` chain makes it the order
 * they actually nest in.
 *
 * Which is worth having because the nesting decides what a short-circuited
 * request keeps. A csrf 403 never reaches the router, so it carries only what
 * the middleware outside csrf adds: the request id, the security headers, the
 * cors headers and the timings — but no language cookie. Move an entry and that
 * changes.
 *
 * Timing sits outside timeout on purpose: a request given up on is one worth
 * having a `Server-Timing` header for.
 *
 * Secure headers is the one entry out of the `apps/hono` order, and on purpose.
 * That app mounts it after csrf, so a rejection there short-circuits before the
 * headers are ever set and the 403 leaves without them. Here it sits second,
 * outside every middleware that answers on its own, so the csrf 403, the
 * timeout 504 and the cors preflight all carry `nosniff` and the rest. It reads
 * nothing and answers nothing, so nothing else in the chain is affected by
 * where it sits.
 */
const middleware = requestId.pipe(
  Layer.flatMap(() => secureHeaders),
  Layer.flatMap(() => cors),
  Layer.flatMap(() => timing),
  Layer.flatMap(() => timeout),
  Layer.flatMap(() => language),
  Layer.flatMap(() => csrf)
);

/**
 * The routes, composed but not served. Both entrypoints hand this to
 * `HttpRouter.serve` with their own platform layer; the app test hands it to
 * `HttpRouter.toWebHandler`.
 *
 * Every new group needs its handler layer in the `Layer.provide` below. To
 * forget it is a runtime defect, not a type error.
 */
export const app = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi" }).pipe(
    Layer.provide(greetingsHandlers)
  ),
  HttpApiScalar.layer(Api, { path: "/openapi/docs" }),
  middleware
);
