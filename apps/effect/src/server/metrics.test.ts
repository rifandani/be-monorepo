import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Metric, Schema } from "effect";

import {
  activeRequests,
  admissionRejections,
  bulkheadAttributes,
  failedRequests,
  failureAttributes,
  failureKind,
  requestAttributes,
  requestDuration,
} from "./metrics.ts";

const withRegistry = <A>(effect: Effect.Effect<A>) =>
  Effect.provideService(effect, Metric.MetricRegistry, new Map());

const BelowServerError = Arbitrary.map(
  Arbitrary.schema(Schema.Int),
  (value) => (Math.abs(value) % 400) + 100
);

const OtherServerError = Arbitrary.map(
  Arbitrary.schema(Schema.Int),
  (value) => [500, 501, 505, 507, 511][Math.abs(value) % 5] ?? 500
);

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

describe(failureKind, () => {
  it("should name a 504 a timeout", () => {
    assert.strictEqual(failureKind(504), "timeout");
  });

  it("should name a 503 a rejection", () => {
    assert.strictEqual(failureKind(503), "rejected");
  });

  it("should name a 502 an upstream failure", () => {
    assert.strictEqual(failureKind(502), "upstream");
  });

  it("should name a 500 a defect", () => {
    assert.strictEqual(failureKind(500), "defect");
  });

  it.prop(
    "should never count a success or a refusal as failed work",
    [BelowServerError],
    ([status]) => {
      assert.isUndefined(failureKind(status));
    }
  );

  it.prop(
    "should always name an unknown server error a defect",
    [OtherServerError],
    ([status]) => {
      assert.strictEqual(failureKind(status), "defect");
    }
  );
});

describe(failureAttributes, () => {
  it("should put the kind in error.type", () => {
    assert.deepStrictEqual(
      failureAttributes({ kind: "timeout", method: "POST" }),
      { "error.type": "timeout", "http.request.method": "POST" }
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

describe("the active requests counter", () => {
  it.effect("should go down when a request ends", () =>
    withRegistry(
      Effect.gen(function* upDown() {
        yield* Metric.update(activeRequests, 1);
        yield* Metric.update(activeRequests, 1);

        yield* Metric.update(activeRequests, -1);

        const state = yield* Metric.value(activeRequests);
        assert.strictEqual(state.count, 1);
      })
    )
  );
});

describe("the failed requests counter", () => {
  it.effect("should keep one series for each kind of failure", () => {
    const timeouts = Metric.withAttributes(
      failedRequests,
      failureAttributes({ kind: "timeout", method: "GET" })
    );

    const defects = Metric.withAttributes(
      failedRequests,
      failureAttributes({ kind: "defect", method: "GET" })
    );

    return withRegistry(
      Effect.gen(function* separate() {
        yield* Metric.update(timeouts, 1);
        yield* Metric.update(timeouts, 1);
        yield* Metric.update(defects, 1);

        assert.strictEqual((yield* Metric.value(timeouts)).count, 2);
        assert.strictEqual((yield* Metric.value(defects)).count, 1);
      })
    );
  });

  it.effect("should never go down", () =>
    withRegistry(
      Effect.gen(function* monotonic() {
        yield* Metric.update(failedRequests, 1);
        yield* Metric.update(failedRequests, -1);

        assert.strictEqual((yield* Metric.value(failedRequests)).count, 1);
      })
    )
  );
});

describe("the admission rejections counter", () => {
  it.effect("should keep the probes apart from the other requests", () => {
    const requests = Metric.withAttributes(
      admissionRejections,
      bulkheadAttributes("requests")
    );

    const probes = Metric.withAttributes(
      admissionRejections,
      bulkheadAttributes("probes")
    );

    return withRegistry(
      Effect.gen(function* bulkheads() {
        yield* Metric.update(requests, 1);

        assert.strictEqual((yield* Metric.value(requests)).count, 1);
        assert.strictEqual((yield* Metric.value(probes)).count, 0);
      })
    );
  });
});
