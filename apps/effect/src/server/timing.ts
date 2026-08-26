import { Context, Duration, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

// `Metrics` names both the state a request collects and the reference that
// carries it, which is the same deliberate pair as `Language` in `language.ts`.
// This rule reads it as a mistake.
// oxlint-disable no-redeclare

// Lowercase because that is how Effect keys a header. Header names are case
// insensitive, so the response carries the same name `apps/hono` sends.
const HEADER = "server-timing";
// The name and the description `hono/timing` gives the metric it measures
// itself, with the options `apps/hono` leaves at their defaults.
const TOTAL = "total";
const TOTAL_DESCRIPTION = "Total Response Time";
// The number of fractional digits `hono/timing` prints a duration with when a
// caller names none.
const DEFAULT_PRECISION = 1;

interface Timer {
  readonly description: string | undefined;
  readonly start: number;
}

/**
 * The Server-Timing state of the request being served: the metrics already
 * finished, in the order they finished, and the timers still running.
 *
 * Mutable, and deliberately so. A metric is recorded from wherever the work
 * happens — a handler, a service below it — and the middleware reads the lot
 * once, on the way out.
 */
export interface Metrics {
  readonly entries: string[];
  readonly timers: Map<string, Timer>;
}

/**
 * The Server-Timing state of the request being served, for a handler or a
 * service to record into.
 *
 * A `Context.Reference` for the same reason as `RequestId` in `request-id.ts`:
 * its default keeps it readable anywhere without becoming a requirement that
 * every caller — and every test — has to satisfy.
 *
 * The default is `undefined` rather than an empty `Metrics`, which is the one
 * place this differs from the references next to it. `Context.Reference` caches
 * what `defaultValue` returns, so a default `Metrics` would be one collector
 * shared by every caller outside a request and nothing would ever drain it —
 * an unbounded array. `undefined` says what is true instead: no request is
 * being served, so there is nothing to record into. The helpers below then do
 * nothing, where `hono/timing` warns.
 */
export const Metrics = Context.Reference<Metrics | undefined>(
  "@workspace/effect/Metrics",
  { defaultValue: (): Metrics | undefined => undefined }
);

/**
 * One Server-Timing metric, in the format the header states them in.
 *
 * Pure, and exported, so the format can be tested without building a request.
 * The four shapes are the ones `hono/timing` emits: a duration with and without
 * a description, and a marker with and without one.
 */
export const formatMetric = (options: {
  readonly name: string;
  readonly duration?: number | undefined;
  readonly description?: string | undefined;
  readonly precision?: number | undefined;
}): string => {
  const described =
    options.description === undefined ? "" : `;desc="${options.description}"`;

  return options.duration === undefined
    ? `${options.name}${described}`
    : `${options.name};dur=${options.duration.toFixed(
        options.precision ?? DEFAULT_PRECISION
      )}${described}`;
};

// `performance.now` and not the `Clock` service, for the reason `request-id.ts`
// reaches for `globalThis.crypto`: a duration is not a value that needs a
// swappable source. It is also the better clock for the job — `Clock` reports
// wall time in milliseconds, which is both coarse enough to print `dur=0.0` for
// most requests and free to step backwards, while `performance.now` is
// monotonic and sub-millisecond. `hono/timing` uses the same one.
const now = () => globalThis.performance.now();

// Every helper below is a no-op outside a request. See `Metrics` for why.
const update = (f: (metrics: Metrics) => void): Effect.Effect<void> =>
  Metrics.pipe(
    Effect.flatMap((metrics) =>
      metrics === undefined ? Effect.void : Effect.sync(() => f(metrics))
    )
  );

// What a timer has measured so far, as a metric. It does not touch the timer,
// so the caller decides whether the timer is done with.
const measure = (
  name: string,
  timer: Timer,
  precision?: number | undefined
): string =>
  formatMetric({
    description: timer.description,
    duration: now() - timer.start,
    name,
    precision,
  });

/**
 * Records a metric on the request being served.
 *
 * Both shapes `hono/timing`'s `setMetric` takes, as one function: name a
 * `duration` for a measurement, leave it out for a marker.
 *
 * @example
 * ```ts
 * yield* setMetric({ description: "europe-west3", name: "region" });
 * yield* setMetric({ duration: Duration.millis(23.8), name: "custom" });
 * ```
 */
export const setMetric = (options: {
  readonly name: string;
  readonly duration?: Duration.Input | undefined;
  readonly description?: string | undefined;
  readonly precision?: number | undefined;
}): Effect.Effect<void> =>
  update((metrics) => {
    metrics.entries.push(
      formatMetric({
        description: options.description,
        duration:
          options.duration === undefined
            ? undefined
            : Duration.toMillis(options.duration),
        name: options.name,
        precision: options.precision,
      })
    );
  });

/**
 * Starts a timer on the request being served.
 *
 * Prefer {@link timed} where the work is one effect. This pair is for a
 * measurement that does not bracket one — a span opened in one step and closed
 * in another.
 */
export const startTime = (options: {
  readonly name: string;
  readonly description?: string | undefined;
}): Effect.Effect<void> =>
  update((metrics) => {
    metrics.timers.set(options.name, {
      description: options.description,
      start: now(),
    });
  });

/**
 * Ends a timer {@link startTime} began and records what it measured.
 *
 * A name that is not running is ignored. `hono/timing` warns; there is nothing
 * to record either way, and the middleware closes whatever is left running when
 * the response leaves.
 */
export const endTime = (options: {
  readonly name: string;
  readonly precision?: number | undefined;
}): Effect.Effect<void> =>
  update((metrics) => {
    const timer = metrics.timers.get(options.name);

    if (timer !== undefined) {
      metrics.timers.delete(options.name);
      metrics.entries.push(measure(options.name, timer, options.precision));
    }
  });

/**
 * Times an effect and records how long it took.
 *
 * The `wrapTime` of `hono/timing`, and the one to reach for by default. It
 * records on every outcome — failure and interruption as well as success —
 * which is what makes the header describe the request that actually happened.
 *
 * @example
 * ```ts
 * const rows = yield* findMany.pipe(timed({ name: "query" }));
 * ```
 */
export const timed =
  (options: {
    readonly name: string;
    readonly description?: string | undefined;
    readonly precision?: number | undefined;
  }) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const start = now();

      return self.pipe(
        Effect.ensuring(
          update((metrics) => {
            metrics.entries.push(
              measure(
                options.name,
                { description: options.description, start },
                options.precision
              )
            );
          })
        )
      );
    });

/**
 * Server-Timing, with the same behaviour as `apps/hono` (`src/app.ts`).
 *
 * Effect has no timing middleware, so this is a port of `hono/timing` with that
 * app's options, which are its defaults: measure the total, describe it as
 * `Total Response Time`, always send the header, and close any timer a handler
 * left running.
 *
 * `crossOrigin` is the one option not ported. It is off in `apps/hono`, and
 * turning it on means sending `Timing-Allow-Origin` — which is a cors decision,
 * and `cors.ts` is where a cors decision belongs.
 *
 * `Effect.suspend` is not decoration. A global middleware function wraps the
 * router once, at layer build, and the effect it returns serves every request
 * after that, so state created outside the `suspend` would be state shared by
 * every request at once.
 *
 * The header is set with `Effect.map`, which runs only on success — like the
 * response header in `request-id.ts`, and with the same consequence: a failed
 * request, the 404 from an unknown path for one, carries no timings.
 */
export const timing = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const metrics: Metrics = { entries: [], timers: new Map() };
      const start = now();

      return httpEffect.pipe(
        Effect.provideService(Metrics, metrics),
        Effect.map((response) => {
          // `total` lands after the metrics the request recorded itself, and
          // the timers it left running land after that — the order
          // `hono/timing` appends them in.
          metrics.entries.push(
            formatMetric({
              description: TOTAL_DESCRIPTION,
              duration: now() - start,
              name: TOTAL,
            })
          );

          for (const [name, timer] of metrics.timers) {
            metrics.entries.push(measure(name, timer));
          }

          metrics.timers.clear();

          return HttpServerResponse.setHeader(
            response,
            HEADER,
            metrics.entries.join(",")
          );
        })
      );
    }),
  { global: true }
);
