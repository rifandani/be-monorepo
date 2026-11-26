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
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";

import { CHAIN } from "#app/chain.ts";
import { app } from "#app/http.ts";
import { tracerDisabledForProbes } from "#app/probes.ts";
import { LIVE_PATH, READY_PATH, STARTUP_PATH } from "#features/health/api.ts";
import { probeAttributes, probeResult } from "#features/health/service.ts";
import { requestAttributes, requestDuration } from "#server/metrics.ts";
import { timeoutFor } from "#server/timeout.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

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

const served = build(tracerDisabledForProbes);

const unguarded = build(Layer.empty);

const get = async (path: string) =>
  served.handler(new Request(`http://localhost${path}`));

const requestCount = (options: {
  readonly method: string;
  readonly status: number;
}) =>
  Effect.provideService(
    Metric.value(
      Metric.withAttributes(requestDuration, requestAttributes(options))
    ),
    Metric.MetricRegistry,
    registry
  );

const fetchPath = (path: string) => Effect.promise(async () => get(path));

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
    it.effect("counts the request it served", () =>
      Effect.gen(function* served200() {
        yield* fetchPath(LIVE_PATH);

        const state = yield* requestCount({ method: "GET", status: 200 });

        assert.strictEqual(state.count, 1);
      })
    );

    it.effect("counts a rejection with the status it sent", () =>
      Effect.gen(function* rejected() {
        yield* Effect.promise(async () =>
          served.handler(new Request("http://localhost/", { method: "POST" }))
        );

        const state = yield* requestCount({ method: "POST", status: 403 });

        assert.strictEqual(state.count, 1);
      })
    );

    it.effect("counts a 404", () =>
      Effect.gen(function* missing() {
        yield* fetchPath("/nope");

        const state = yield* requestCount({ method: "GET", status: 404 });

        assert.strictEqual(state.count, 1);
      })
    );

    it.effect("records the duration in seconds, not milliseconds", () =>
      Effect.gen(function* duration() {
        yield* fetchPath(LIVE_PATH);

        const state = yield* requestCount({ method: "GET", status: 200 });

        assert.isAbove(state.sum, 0);
        assert.isBelow(state.sum, 1);
      })
    );
  });

  describe("Probe Silence", () => {
    it("sends no log line for any of the three probes", async () => {
      await Promise.all([STARTUP_PATH, LIVE_PATH, READY_PATH].map(get));

      assert.deepStrictEqual(logRecords, []);
    });

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

    it("keeps the spans for the readiness probe", async () => {
      await get(READY_PATH);

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["GET", "Health.ready"]
      );
    });

    it("keeps the span for ordinary traffic", async () => {
      await get("/openapi");

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["GET"]
      );
    });

    it("needs its layer as well as its middleware", async () => {
      await unguarded.handler(new Request(`http://localhost${LIVE_PATH}`));

      assert.deepStrictEqual(
        spans.map((span) => span.name),
        ["GET"]
      );
    });
  });

  describe("Probe Outcome", () => {
    it.effect("counts an outcome for a real probe call", () =>
      Effect.gen(function* probeOutcome() {
        yield* fetchPath(LIVE_PATH);

        const state = yield* Effect.provideService(
          Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "live" })
            )
          ),
          Metric.MetricRegistry,
          registry
        );

        assert.strictEqual(state.count, 1);
      })
    );
  });

  describe("the Middleware Chain", () => {
    it.effect("registers one global middleware per declared entry", () => {
      const registrations: unknown[] = [];

      const counting = Layer.effect(HttpRouter.HttpRouter)(
        Effect.map(HttpRouter.make, (router) =>
          HttpRouter.HttpRouter.of({
            ...router,
            addGlobalMiddleware: (fn) => {
              registrations.push(fn);

              return router.addGlobalMiddleware(fn);
            },
          })
        )
      );

      return Effect.gen(function* chain() {
        yield* Effect.scoped(
          Layer.build(
            app.pipe(
              Layer.provideMerge(counting),
              Layer.provide([HttpServer.layerServices, configProvider])
            )
          )
        );

        assert.strictEqual(registrations.length, CHAIN.length);
      });
    });
  });

  describe("the admission middleware", () => {
    const entered = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();

    const held = HttpRouter.add(
      "GET",
      "/held",
      Effect.promise(async () => {
        entered.resolve(true);
        await release.promise;

        return HttpServerResponse.text("done");
      })
    );

    const full = HttpRouter.toWebHandler(
      Layer.mergeAll(app, held).pipe(
        Layer.provide([
          HttpServer.layerServices,
          ConfigProvider.layer(
            ConfigProvider.fromEnvRecord({
              APP_URL: `${ALLOWED_ORIGIN}/`,
              MAX_IN_FLIGHT_PROBES: "1",
              MAX_IN_FLIGHT_REQUESTS: "1",
            })
          ),
        ])
      ),
      { disableLogger: true }
    );

    const send = async (path: string) =>
      full.handler(new Request(`http://localhost${path}`));

    afterAll(async () => full.dispose());

    it("answers the request after the limit with 503 and Retry-After, and keeps the probes up", async () => {
      const first = send("/held");
      await entered.promise;

      const rejected = await send("/held");
      const probe = await send(LIVE_PATH);

      release.resolve(true);
      const admitted = await first;
      const after = await send("/held");

      assert.strictEqual(rejected.status, 503);
      assert.strictEqual(rejected.headers.get("retry-after"), "1");
      assert.isNotNull(rejected.headers.get("x-request-id"));
      assert.deepStrictEqual(await rejected.json(), {
        message: "Service Unavailable",
      });
      assert.strictEqual(probe.status, 200);
      assert.strictEqual(admitted.status, 200);
      assert.strictEqual(after.status, 200);
    });
  });

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

    afterAll(async () => dispose());

    it("answers 504 when the handler outlasts the duration", async () => {
      const response = await handler(new Request("http://localhost/slow"));

      assert.strictEqual(response.status, 504);
      assert.strictEqual(await response.text(), "Gateway Timeout");
    });
  });
});
