import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

// Lowercase because that is how Effect keys a header. Header names are case
// insensitive, so the response carries the same name `apps/hono` sends.
const HEADER = "server-timing";
// The name, the description and the precision `hono/timing` gives the metric it
// measures itself, with the options `apps/hono` leaves at their defaults
// (`src/app.ts` mounts `timing()` and passes none). These four values are the
// parity that matters — see the note on the middleware below.
const TOTAL = "total";
const TOTAL_DESCRIPTION = "Total Response Time";
const PRECISION = 1;

// `performance.now` and not the `Clock` service, for the reason `request-id.ts`
// reaches for `globalThis.crypto`: a duration is not a value that needs a
// swappable source. It is also the better clock for the job — `Clock` reports
// wall time in milliseconds, which is both coarse enough to print `dur=0.0` for
// most requests and free to step backwards, while `performance.now` is
// monotonic and sub-millisecond. `hono/timing` uses the same one.
// Exported so `metrics.ts`, which times the same interval, reads one clock.
export const now = (): number => globalThis.performance.now();

/**
 * Server-Timing: the total time the response took, reported to the caller.
 *
 * Effect has no timing middleware, so this is a port of `hono/timing` with the
 * options `apps/hono` uses, which are its defaults: measure the total and
 * describe it as `Total Response Time`.
 *
 * Only the total. `hono/timing` also lets a handler record its own metrics —
 * `setMetric`, `startTime`/`endTime`, `wrapTime` — and that half was ported and
 * then removed: the app's three handlers recorded nothing, `apps/hono` calls
 * none of it either, and 120 lines of it were reachable only from their own
 * test. Re-port it from `hono/timing` if a handler ever has a duration of its
 * own worth sending — a query, an upstream call. What it needs is a mutable
 * collector provided per request; note that a `Context.Reference` cannot hold
 * one by default, for the reason `request-id.ts` records.
 *
 * `crossOrigin` is the one option not ported. It is off in `apps/hono`, and
 * turning it on means sending `Timing-Allow-Origin` — which is a cors decision,
 * and `cors.ts` is where a cors decision belongs.
 *
 * `Effect.suspend` is not decoration. A global middleware function wraps the
 * router once, at layer build, and the effect it returns serves every request
 * after that, so the clock read outside the `suspend` would be one start time
 * shared by every request at once.
 *
 * The header is set with `Effect.map`, which runs only on success — and nothing
 * that reaches here is a failure. `onError` and `notFound` are innermost and
 * turn one into a response before this middleware sees it, which is what makes
 * a 404 and a 500 carry the header a 200 does; `tests/app.test.ts` asserts the
 * 404 case. A failure that got past those two would leave without timings. See
 * the chain in `chain.ts`, which also states why this sits outside `timeout`.
 */
export const timing = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const start = now();

      return httpEffect.pipe(
        Effect.map((response) =>
          HttpServerResponse.setHeader(
            response,
            HEADER,
            `${TOTAL};dur=${(now() - start).toFixed(
              PRECISION
            )};desc="${TOTAL_DESCRIPTION}"`
          )
        )
      );
    }),
  { global: true }
);
