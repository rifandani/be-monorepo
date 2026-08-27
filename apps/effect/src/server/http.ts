import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { Api } from "../api/api.js";
import { cors } from "./cors.js";
import { csrf } from "./csrf.js";
import { onError } from "./error.js";
import { healthHandlers } from "./health/http.js";
import { language } from "./language.js";
import { metrics } from "./metrics.js";
import { notFound } from "./not-found.js";
import { quietProbes } from "./probes.js";
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
 * nesting to whichever layer won the race. Seven of these are the seven
 * `apps/hono` mounts (`src/app.ts`), in that app's order, and the `flatMap`
 * chain makes it the order they actually nest in.
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
 * `onError` and `notFound` are innermost, which is the other placement worth
 * stating. Every middleware above sets its headers with `Effect.map`, which
 * runs only on success, so a failure that travelled past them would leave
 * without a request id, a `Server-Timing` header or the security headers.
 * Turning the failure into a response down here, before any of them see it,
 * is what makes a 404 and a 500 carry the same headers a 200 does. `notFound`
 * is inside `onError` so the miss it claims never reaches the catch-all.
 *
 * Secure headers is the one entry out of the `apps/hono` order, and on purpose.
 * That app mounts it after csrf, so a rejection there short-circuits before the
 * headers are ever set and the 403 leaves without them. Here it sits outside
 * every middleware that answers on its own, so the csrf 403, the timeout 504
 * and the cors preflight all carry `nosniff` and the rest. It reads nothing and
 * answers nothing, so nothing else in the chain is affected by where it sits.
 *
 * `metrics` and `quietProbes` are the two entries `apps/hono` has no
 * counterpart for, and they sit as far out as they can. `metrics` records the
 * status of the response that actually leaves, so it has to be outside `onError`
 * and `notFound`; being outside `cors` and `csrf` as well is what makes the
 * preflight and the 403 count as the served traffic they are. Neither reads or
 * writes a response, so like secure headers they change nothing else by sitting
 * here.
 */
const middleware = requestId.pipe(
  Layer.flatMap(() => metrics),
  Layer.flatMap(() => quietProbes),
  Layer.flatMap(() => secureHeaders),
  Layer.flatMap(() => cors),
  Layer.flatMap(() => timing),
  Layer.flatMap(() => timeout),
  Layer.flatMap(() => language),
  Layer.flatMap(() => csrf),
  Layer.flatMap(() => onError),
  Layer.flatMap(() => notFound)
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
    Layer.provide(healthHandlers)
  ),
  HttpApiScalar.layer(Api, { path: "/openapi/docs" }),
  middleware
);
