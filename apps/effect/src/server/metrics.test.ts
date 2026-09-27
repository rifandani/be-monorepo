import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { requestAttributes, requestDuration } from "./metrics.ts";

// The middleware is asserted where it runs, in `tests/middleware.test.ts`: a
// request through the composed app, against a registry of its own. What is left
// here is what a request cannot state, because it cannot choose its own
// duration — the series key, and the unit the buckets are written in.
//
// The registry is supplied explicitly and not left to its default. It is a
// `Context.Reference`, and a `Context.Reference` caches what `defaultValue`
// returns — so the default registry is one `Map` shared by every test in the
// process, and a count asserted against it would depend on which files ran
// first. A fresh `Map` per run is what makes each assertion below about its own
// recordings only.
const run = <A>(effect: Effect.Effect<A>): A =>
  Effect.runSync(
    Effect.provideService(effect, Metric.MetricRegistry, new Map())
  );

// A series is keyed by `JSON.stringify(Object.entries(attributes))`, so this
// helper is the contract that a reader and a writer name the same series.
describe(requestAttributes, () => {
  it("states the method before the status", () => {
    assert.deepStrictEqual(
      Object.entries(requestAttributes({ method: "GET", status: 200 })),
      [
        ["http.request.method", "GET"],
        ["http.response.status_code", "200"],
      ]
    );
  });
});

describe("the request duration histogram", () => {
  // The boundaries are the semantic convention's, and the convention states
  // them in seconds. A boundary set written in milliseconds has no 0.25 in it
  // at all, so this is what fails then. That the recording converts *to* those
  // seconds is a separate claim, and a real request asserts it — see
  // `tests/middleware.test.ts`.
  it("buckets a duration by seconds", () => {
    const series = Metric.withAttributes(
      requestDuration,
      requestAttributes({ method: "GET", status: 200 })
    );

    const state = run(
      Effect.gen(function* record() {
        yield* Metric.update(series, 0.25);

        return yield* Metric.value(series);
      })
    );

    const bucket = state.buckets.find(([boundary]) => boundary === 0.25);

    assert.deepStrictEqual(bucket, [0.25, 1]);
  });
});
