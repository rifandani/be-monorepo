import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import {
  probeAttributes,
  probeResult,
  recordProbe,
  recordRequest,
  requestAttributes,
  requestDuration,
} from "./metrics.ts";

// The middleware is covered through the composed app in `tests/app.test.ts`.
// What is left is the recording, which needs a registry rather than a request.
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

// A series is keyed by `JSON.stringify(Object.entries(attributes))`, so these
// two helpers are the contract that a reader and a writer name the same series.
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

describe(probeAttributes, () => {
  it("states the probe before the outcome", () => {
    assert.deepStrictEqual(
      Object.entries(probeAttributes({ outcome: "ok", probe: "ready" })),
      [
        ["probe", "ready"],
        ["outcome", "ok"],
      ]
    );
  });
});

describe(recordRequest, () => {
  it("records the duration in seconds, not milliseconds", () => {
    const state = run(
      Effect.gen(function* record() {
        yield* recordRequest({ duration: 250, method: "GET", status: 200 });

        return yield* Metric.value(
          Metric.withAttributes(
            requestDuration,
            requestAttributes({ method: "GET", status: 200 })
          )
        );
      })
    );

    assert.strictEqual(state.count, 1);
    assert.strictEqual(state.sum, 0.25);
  });

  it("keeps each method and status on its own series", () => {
    const [get, post] = run(
      Effect.gen(function* record() {
        yield* recordRequest({ duration: 1000, method: "GET", status: 200 });
        yield* recordRequest({ duration: 2000, method: "POST", status: 403 });

        return [
          yield* Metric.value(
            Metric.withAttributes(
              requestDuration,
              requestAttributes({ method: "GET", status: 200 })
            )
          ),
          yield* Metric.value(
            Metric.withAttributes(
              requestDuration,
              requestAttributes({ method: "POST", status: 403 })
            )
          ),
        ] as const;
      })
    );

    assert.strictEqual(get.count, 1);
    assert.strictEqual(get.sum, 1);
    assert.strictEqual(post.count, 1);
    assert.strictEqual(post.sum, 2);
  });

  // 250ms lands in the `[0, 0.25]` bucket and not the one below it, which is
  // the assertion that the boundaries are read as seconds. A millisecond-valued
  // histogram would put every request this app serves in the last bucket.
  it("falls in the bucket its duration belongs to", () => {
    const state = run(
      Effect.gen(function* record() {
        yield* recordRequest({ duration: 250, method: "GET", status: 200 });

        return yield* Metric.value(
          Metric.withAttributes(
            requestDuration,
            requestAttributes({ method: "GET", status: 200 })
          )
        );
      })
    );

    const bucket = state.buckets.find(([boundary]) => boundary === 0.25);

    assert.deepStrictEqual(bucket, [0.25, 1]);
  });
});

describe(recordProbe, () => {
  it("counts a probe by name and outcome", () => {
    const [live, ready] = run(
      Effect.gen(function* record() {
        yield* recordProbe({ outcome: "ok", probe: "live" });
        yield* recordProbe({ outcome: "ok", probe: "live" });
        yield* recordProbe({ outcome: "unhealthy", probe: "ready" });

        return [
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "live" })
            )
          ),
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "unhealthy", probe: "ready" })
            )
          ),
        ] as const;
      })
    );

    assert.strictEqual(live.count, 2);
    assert.strictEqual(ready.count, 1);
  });

  // A readiness failure and a readiness success are the two series a dashboard
  // divides to get an error rate, so they must not collapse into one.
  it("keeps the outcomes of one probe apart", () => {
    const state = run(
      Effect.gen(function* record() {
        yield* recordProbe({ outcome: "ok", probe: "ready" });
        yield* recordProbe({ outcome: "unhealthy", probe: "ready" });

        return yield* Metric.value(
          Metric.withAttributes(
            probeResult,
            probeAttributes({ outcome: "ok", probe: "ready" })
          )
        );
      })
    );

    assert.strictEqual(state.count, 1);
  });
});
