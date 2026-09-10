import { Duration, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

/**
 * How long a request may take before it is given up on.
 *
 * The 15 seconds `apps/hono` passes to `timeout` in `src/app.ts`. A `Duration`
 * rather than the bare `15_000` that middleware takes, because a unit that is
 * written down cannot be misread.
 */
const TIMEOUT = Duration.seconds(15);

// The status and the body `hono/timeout` answers with by default. Built once:
// an `HttpServerResponse` is a value, and this one never varies.
const GATEWAY_TIMEOUT = HttpServerResponse.text("Gateway Timeout", {
  status: 504,
});

/**
 * Gives up on a request that takes longer than `duration` and answers 504.
 *
 * Separate from the middleware below, and taking its duration, so a test can
 * drive it without waiting out the real one.
 *
 * `Effect.timeoutOrElse` and not `Effect.timeout`: the latter fails with a
 * `TimeoutError`, which would widen the error channel out to whatever serves
 * the app. The 504 is returned as a response for the same reason the 403 in
 * `csrf.ts` is, and the client sees the same thing either way.
 */
export const withTimeout =
  (duration: Duration.Duration) =>
  <E, R>(
    self: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
    self.pipe(
      Effect.timeoutOrElse({
        duration,
        orElse: () =>
          Effect.as(
            Effect.logWarning("Request timed out").pipe(
              Effect.annotateLogs("timeout", Duration.format(duration))
            ),
            GATEWAY_TIMEOUT
          ),
      })
    );

/**
 * Timeout, with the same behaviour as `apps/hono` (`src/app.ts`): 15 seconds,
 * then a 504.
 *
 * Effect has no timeout middleware, so this is a port of `hono/timeout` — and
 * the port is the stronger of the two. `hono/timeout` races `next()` against a
 * `setTimeout` and answers whichever settles first, which means the handler it
 * gave up on keeps running: its database call, its outbound request and its
 * writes all continue, unobserved. `Effect.timeoutOrElse` interrupts the fiber
 * instead, so the work stops and the finalizers in its scope run.
 *
 * The warning is logged where `apps/hono` logs one from `app.onError`, and it
 * carries the request id because `request-id.ts` sits outside this middleware.
 * See the chain in `http.ts`.
 */
export const timeout = HttpRouter.middleware(withTimeout(TIMEOUT), {
  global: true,
});
