import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from "@opentelemetry/semantic-conventions";
import { Effect, Metric } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

// One clock for the app: see the note on `now` in `timing.ts`.
import { now } from "./timing.ts";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The bucket boundaries the OpenTelemetry semantic conventions give
 * `http.server.request.duration`, in seconds.
 *
 * Stated rather than generated with `Metric.linearBoundaries` or
 * `exponentialBoundaries`: the point of matching the convention is that a
 * dashboard built elsewhere reads these histograms without being told anything,
 * and a nearly-right bucket set is one it renders wrongly.
 */
const DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

/**
 * How long an inbound request took, in seconds.
 *
 * The name, the unit and the boundaries are all the semantic convention's, not
 * Effect's. `Metric.timer` would have been the shorter way to write this and
 * records milliseconds under a `time_unit` attribute, which every prebuilt
 * OTLP dashboard ignores — the whole reason to export over OTLP is that
 * something downstream already knows what the measurement means.
 *
 * There is deliberately no companion request counter: a histogram carries its
 * own `count`, so a second metric over the same events would only cost money.
 */
export const requestDuration = Metric.histogram(
  METRIC_HTTP_SERVER_REQUEST_DURATION,
  {
    description: "Duration of inbound HTTP requests, in seconds",
    boundaries: DURATION_BOUNDARIES,
  }
);

/**
 * The attributes one request's series is keyed by.
 *
 * Exported, and the only place these two keys are written, because a metric's
 * series is keyed by `JSON.stringify(Object.entries(attributes))` — so
 * `{ method, status }` and `{ status, method }` are two different time series
 * holding half the traffic each. One helper is what makes the insertion order
 * a single fact rather than a convention every call site has to remember.
 *
 * The status is stringified because Effect's metric attributes are string to
 * string. The semantic convention types `http.response.status_code` as an
 * integer, so a backend that enforces that reads this as a string label.
 */
export const requestAttributes = (options: {
  readonly method: string;
  readonly status: number;
}) => ({
  [ATTR_HTTP_REQUEST_METHOD]: options.method,
  [ATTR_HTTP_RESPONSE_STATUS_CODE]: String(options.status),
});

/**
 * Records how long a request took.
 *
 * Exported, and the middleware below is a thin caller of it, so the recording
 * can be asserted from a test that never builds a request — `Metric.value` and
 * the update have to run under one registry to be readable, which a request
 * through the composed app cannot offer.
 *
 * `duration` is in milliseconds because that is what a clock difference is
 * here; the conversion to the metric's unit belongs in one place, and this is
 * it.
 */
export const recordRequest = (options: {
  readonly method: string;
  readonly status: number;
  readonly duration: number;
}): Effect.Effect<void> =>
  Metric.update(
    Metric.withAttributes(requestDuration, requestAttributes(options)),
    options.duration / MILLISECONDS_PER_SECOND
  );

/**
 * The request metric.
 *
 * No `http.route` attribute, and that is a limitation worth stating rather than
 * hiding. A route label has to be the matched template — `/users/{id}`, never
 * `/users/42`, or every id becomes its own time series. This middleware runs
 * outside `HttpApiBuilder`'s routing, where only the raw path is known, so
 * labelling by path would be safe for the static paths this app has today and a
 * cardinality explosion the first time someone adds `/users/:id`. Per-path
 * analysis lives in the traces instead, where the server span records
 * `url.path`. Recording this inside `HttpApiBuilder`, where the endpoint name
 * is known, is the honest fix if a route breakdown is ever wanted.
 *
 * `Effect.suspend` for the reason `timing.ts` needs it: a global middleware
 * function wraps the router once, at layer build, so a start time captured
 * outside the `suspend` would be one start time shared by every request.
 *
 * The recording runs only on success — the third convention in
 * `docs/http-api.md`. `onError` and `notFound` are innermost, so every
 * response this app makes on purpose reaches here as a success value and is
 * counted with the status the client actually got. A cause that travelled past
 * them would be a defect in the middleware chain, not a request.
 */
export const metrics = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const start = now();

      return Effect.gen(function* record() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* httpEffect;

        yield* recordRequest({
          duration: now() - start,
          method: request.method,
          status: response.status,
        });

        return response;
      });
    }),
  { global: true }
);
