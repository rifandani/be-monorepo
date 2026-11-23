import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { requestAttributes, requestDuration } from "./metrics.ts";

const withRegistry = <A>(effect: Effect.Effect<A>) =>
  Effect.provideService(effect, Metric.MetricRegistry, new Map());

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
  it.effect("buckets a duration by seconds", () => {
    const series = Metric.withAttributes(
      requestDuration,
      requestAttributes({ method: "GET", status: 200 })
    );

    return withRegistry(
      Effect.gen(function* record() {
        yield* Metric.update(series, 0.25);

        const state = yield* Metric.value(series);
        const bucket = state.buckets.find(([boundary]) => boundary === 0.25);

        assert.deepStrictEqual(bucket, [0.25, 1]);
      })
    );
  });
});
