import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { Api } from "#api/api.ts";

import { cors } from "./cors.ts";
import { csrf } from "./csrf.ts";
import { onError } from "./error.ts";
import { Health } from "./health.ts";
import { language } from "./language.ts";
import { metrics } from "./metrics.ts";
import { notFound } from "./not-found.ts";
import { quietProbes } from "./probes.ts";
import { requestId } from "./request-id.ts";
import { secureHeaders } from "./secure-headers.ts";
import { timeout } from "./timeout.ts";
import { timing } from "./timing.ts";

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
 * request keeps. Csrf is the innermost of the ten, so its 403 carries what all
 * of them add — the request id, the security headers, the cors headers, the
 * timings, and the language cookie when the request asked for a language. The
 * cors preflight is the sparse one: cors answers it before timing runs, so it
 * leaves with no timings and no cookie. The timeout 504 keeps the timings and
 * loses the cookie, because timing is outside timeout and language is inside
 * it. Move an entry and that table changes; it is asserted, row by row, in
 * `tests/nesting.test.ts`.
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
 * The chain takes its timeout layer rather than closing over `timeout`, and
 * that is the one concession this composition makes to a test. No route here
 * answers slowly enough to exceed 15 seconds, so a 504 over this chain is
 * unreachable — and the 504 is the only response that can show that timing sits
 * outside timeout. `tests/nesting.test.ts` builds the same chain with a short
 * timeout and a slow route of its own. The layer and not the duration, so
 * `TIMEOUT` stays private to `timeout.ts`.
 *
 * `metrics` and `quietProbes` are the two entries `apps/hono` has no
 * counterpart for, and they sit as far out as they can. `metrics` records the
 * status of the response that actually leaves, so it has to be outside `onError`
 * and `notFound`; being outside `cors` and `csrf` as well is what makes the
 * preflight and the 403 count as the served traffic they are. Neither reads or
 * writes a response, so like secure headers they change nothing else by sitting
 * here.
 */
const middlewareWith = (timeoutLayer: typeof timeout) =>
  requestId.pipe(
    Layer.flatMap(() => metrics),
    Layer.flatMap(() => quietProbes),
    Layer.flatMap(() => secureHeaders),
    Layer.flatMap(() => cors),
    Layer.flatMap(() => timing),
    Layer.flatMap(() => timeoutLayer),
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
 *
 * What a short-circuited response carries out of this chain is asserted in
 * `tests/nesting.test.ts`, one row per middleware that answers on its own.
 */
export const appWith = (timeoutLayer: typeof timeout) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api, { openapiPath: "/openapi" }).pipe(
      Layer.provide(Health.handlers.pipe(Layer.provide(Health.layer)))
    ),
    HttpApiScalar.layer(Api, { path: "/openapi/docs" }),
    middlewareWith(timeoutLayer)
  );

/** The app as it is served, with the timeout `timeout.ts` states. */
export const app = appWith(timeout);
