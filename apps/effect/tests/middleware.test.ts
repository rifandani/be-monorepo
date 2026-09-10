import { afterAll, assert, beforeEach, describe, it } from "@effect/vitest";
import {
  ConfigProvider,
  Duration,
  Effect,
  Layer,
  Logger,
  Metric,
  References,
  Tracer,
} from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http";

import { LIVE_PATH, READY_PATH, STARTUP_PATH } from "#api/health.ts";
import { probeAttributes, probeResult } from "#server/health.ts";
import { app } from "#server/http.ts";
import { requestAttributes, requestDuration } from "#server/metrics.ts";
import { tracerDisabledForProbes } from "#server/probes.ts";
import { timeoutFor } from "#server/timeout.ts";

/*
 * What the global middleware does, asserted where it runs.
 *
 * `tests/app.test.ts` asks what this app serves and what a response carries.
 * This suite asks a different question — does each entry in the chain in
 * `src/server/http.ts` actually run — and it exists because coverage cannot
 * ask it. The `metrics`, `timeout` and `quietProbes` layers all read 100% on
 * the per-file gate while nothing asserted them: the requests in the other
 * suites execute them, and a test on the function each one calls says only
 * that the function works. See `docs/adr/0001`.
 *
 * Three collectors make the three answers readable, and each is a fact worth
 * stating because none of them is obvious:
 *
 * - `Layer.provideMerge` and not `Layer.provide`. `HttpRouter.toWebHandler`
 *   uses the built layer's *output* context as the base context of every
 *   request fiber, so a reference only reaches a request if it is merged out.
 *   That is what makes a metric recorded inside a request readable after it.
 * - The framework's per-request log line is applied outside the router by
 *   `HttpRouter.toWebHandler` itself, and `disableLogger: true` — which
 *   `tests/app.test.ts` passes — switches it off. It stays on here, and a
 *   collecting `Logger` replaces the default one, so an absent line is an
 *   assertion rather than a silence.
 * - The tracer needs no wiring at all: `HttpEffect.toHandled` applies
 *   `HttpMiddleware.tracer` unconditionally, so the server span is opened for
 *   a `toWebHandler` request already. Passing `middleware:
 *   HttpMiddleware.tracer` as well opens two.
 */

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

// The cors layer reads `APP_URL`, and this project deliberately runs its tests
// without an env file (see `vitest.config.ts`). See `tests/app.test.ts`.
const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

// `defaultValue()` and not the default itself. `Metric.MetricRegistry` is a
// `Context.Reference`, and a `Context.Reference` caches what `defaultValue`
// returns, so the ambient registry is one `Map` shared by every test in the
// process. Calling the factory gives this file a registry of its own.
const registry = Metric.MetricRegistry.defaultValue();
const logRecords: {
  readonly annotations: Record<string, unknown>;
  readonly message: unknown;
}[] = [];
const spans: Tracer.Span[] = [];

const collector = Logger.make((options) => {
  logRecords.push({
    annotations: options.fiber.getRef(References.CurrentLogAnnotations),
    message: options.message,
  });
});

// A `NativeSpan` is the span Effect's own default tracer makes, so collecting
// them changes nothing about what the app does — only that they are kept.
const collectingTracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);

    spans.push(span);

    return span;
  },
});

const collectors = Layer.mergeAll(
  Layer.succeed(Metric.MetricRegistry)(registry),
  Logger.layer([collector]),
  Layer.succeed(Tracer.Tracer)(collectingTracer)
);

const build = (extra: Layer.Layer<never>) =>
  HttpRouter.toWebHandler(
    app.pipe(
      Layer.provideMerge(Layer.mergeAll(collectors, extra)),
      Layer.provide([HttpServer.layerServices, configProvider])
    )
  );

// The tracer exclusion is provided the way the entrypoints provide it. Nothing
// forces it to be entrypoint-only; it is a layer, and a test can hand it over.
const served = build(tracerDisabledForProbes);
// The same app without it, for the one case below that needs the app as it
// would be if that layer were forgotten.
const unguarded = build(Layer.empty);

const get = (path: string) =>
  served.handler(new Request(`http://localhost${path}`));

const requestCount = (options: {
  readonly method: string;
  readonly status: number;
}) =>
  Effect.runSync(
    Effect.provideService(
      Metric.value(
        Metric.withAttributes(requestDuration, requestAttributes(options))
      ),
      Metric.MetricRegistry,
      registry
    )
  );

// One outer describe so the collectors are cleared for every case below.
describe("the global middleware", () => {
  beforeEach(() => {
    registry.clear();
    logRecords.length = 0;
    spans.length = 0;
  });

  afterAll(async () => {
    await served.dispose();
    await unguarded.dispose();
  });

  describe("the metrics middleware", () => {
    it("counts the request it served", async () => {
      await get(LIVE_PATH);

      assert.strictEqual(requestCount({ method: "GET", status: 200 }).count, 1);
    });

    // `metrics` sits outside `csrf`, `onError` and `notFound` in the chain, so
    // the status it records is the one the client got and not the one the router
    // would have answered. These two are what that placement is for.
    it("counts a rejection with the status it sent", async () => {
      await served.handler(
        new Request("http://localhost/", { method: "POST" })
      );

      assert.strictEqual(
        requestCount({ method: "POST", status: 403 }).count,
        1
      );
    });

    it("counts a 404", async () => {
      await get("/nope");

      assert.strictEqual(requestCount({ method: "GET", status: 404 }).count, 1);
    });

    // The recording converts a clock difference in milliseconds to the seconds
    // the metric's boundaries are written in. A probe answers in single-figure
    // milliseconds, so a sum below one second is a statement that the conversion
    // happened; without it this request would record about 3, and land in the
    // last bucket of a histogram that goes to 10 seconds.
    it("records the duration in seconds, not milliseconds", async () => {
      await get(LIVE_PATH);

      const state = requestCount({ method: "GET", status: 200 });

      assert.isAbove(state.sum, 0);
      assert.isBelow(state.sum, 1);
    });
  });

  describe("Probe Silence", () => {
    it("sends no log line for any of the three probes", async () => {
      await Promise.all([STARTUP_PATH, LIVE_PATH, READY_PATH].map(get));

      assert.deepStrictEqual(logRecords, []);
    });

    // The other half of the same assertion: the line exists, and the probes are
    // the exception. Without this one, a logger that never ran would pass above.
    it("logs an ordinary request", async () => {
      await get("/openapi");

      assert.strictEqual(logRecords.length, 1);
      assert.deepStrictEqual(logRecords[0]?.message, ["Sent HTTP response"]);
      assert.strictEqual(logRecords[0]?.annotations["http.url"], "/openapi");
    });

    it("opens no span for the startup and liveness probes", async () => {
      await Promise.all([STARTUP_PATH, LIVE_PATH].map(get));

      assert.deepStrictEqual(spans, []);
    });

    // The readiness probe runs the Checks, so its span describes work. Both the
    // server span and the handler's own span survive.
    it("keeps the spans for the readiness probe", async () => {
      await get(READY_PATH);

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["http.server GET", "Health.ready"]
      );
    });

    it("keeps the span for ordinary traffic", async () => {
      await get("/openapi");

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["http.server GET"]
      );
    });

    // `probes.ts` claims neither half of the policy is sufficient alone, and
    // this is that claim. The server span is opened outside the router, before
    // `quietProbes` runs, so nothing the middleware does can prevent it — only
    // the layer the entrypoints provide can. Drop the layer and the liveness
    // probe is traced again, while the middleware is untouched.
    it("needs its layer as well as its middleware", async () => {
      await unguarded.handler(new Request(`http://localhost${LIVE_PATH}`));

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["http.server GET"]
      );
    });
  });

  // The service test in `src/server/health.test.ts` asserts every outcome this
  // counter records. What it cannot say is that a call over the mount point
  // reaches it at all, which is what this one adds.
  describe("Probe Outcome", () => {
    it("counts an outcome for a real probe call", async () => {
      await get(LIVE_PATH);

      const state = Effect.runSync(
        Effect.provideService(
          Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "live" })
            )
          ),
          Metric.MetricRegistry,
          registry
        )
      );

      assert.strictEqual(state.count, 1);
    });
  });

  // No route in this app answers slowly enough to time out, so the layer is
  // built here with a duration of its own over a router of its own — the same
  // thing `timeout.test.ts` does with the combinator, one level out. What this
  // adds is that the layer wraps a router with it and a real 504 leaves.
  describe("the timeout middleware", () => {
    const slow = HttpRouter.add(
      "GET",
      "/slow",
      Effect.as(
        Effect.sleep(Duration.seconds(1)),
        HttpServerResponse.text("done")
      )
    );

    const { dispose, handler } = HttpRouter.toWebHandler(
      Layer.mergeAll(slow, timeoutFor(Duration.millis(10))).pipe(
        Layer.provide(HttpServer.layerServices)
      ),
      { disableLogger: true }
    );

    afterAll(() => dispose());

    it("answers 504 when the handler outlasts the duration", async () => {
      const response = await handler(new Request("http://localhost/slow"));

      assert.strictEqual(response.status, 504);
      assert.strictEqual(await response.text(), "Gateway Timeout");
    });
  });
});
