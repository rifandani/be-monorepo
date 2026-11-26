import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as fc from "fast-check";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { admissionMiddleware, RETRY_AFTER_SECONDS } from "./admission.ts";
import { METRIC_HTTP_SERVER_ADMISSION_REJECTIONS } from "./metrics.ts";

const PROBE_PATH = "/health/live";

interface Held {
  readonly entered: Promise<boolean>;
  readonly response: Promise<Response>;
}

const collectingReader = () =>
  new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 3_600_000,
  });

const rejectionsBy = async (reader: PeriodicExportingMetricReader) => {
  const { resourceMetrics } = await reader.collect();

  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find(
      (data) => data.descriptor.name === METRIC_HTTP_SERVER_ADMISSION_REJECTIONS
    );

  return Object.fromEntries(
    (metric?.dataPoints ?? []).map((point) => [
      String(point.attributes.bulkhead),
      point.value,
    ])
  );
};

const heldApp = (
  capacity: { requests: number; probes: number },
  meter = metrics.getMeter("test")
) => {
  const arrivals: ((value: boolean) => void)[] = [];
  const release = Promise.withResolvers<boolean>();
  const app = new Hono();

  app.use(
    "*",
    admissionMiddleware({
      ...capacity,
      isProbePath: (path) => path === PROBE_PATH,
      meter,
    })
  );
  app.get("/held", async (c) => {
    arrivals.shift()?.(true);
    await release.promise;

    return c.text("done");
  });
  app.get("/fail", () => {
    throw new Error("boom");
  });
  app.get(PROBE_PATH, (c) => c.text("alive"));
  app.onError((_error, c) => c.text("failed", 500));

  const hold = (): Held => {
    const entered = Promise.withResolvers<boolean>();
    arrivals.push(entered.resolve);

    return {
      entered: entered.promise,
      response: Promise.resolve(app.request("/held")),
    };
  };

  return {
    app,
    hold,
    release: () => {
      release.resolve(true);
    },
  };
};

const statusOf = async (held: Held) => {
  const response = await held.response;

  return response.status;
};

describe(admissionMiddleware, () => {
  it("should let a request through when a slot is free", async () => {
    const { app } = heldApp({ probes: 1, requests: 1 });

    const response = await app.request(PROBE_PATH);

    expect(response.status).toBe(200);
  });

  it("should answer 503 with Retry-After to the request after the limit", async () => {
    const { app, hold, release } = heldApp({ probes: 1, requests: 1 });
    const first = hold();
    await first.entered;

    const rejected = await app.request("/held");
    release();
    await first.response;

    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("Retry-After")).toBe(
      String(RETRY_AFTER_SECONDS)
    );
    await expect(rejected.json()).resolves.toStrictEqual({
      message: "Service Unavailable",
    });
  });

  it("should count a rejection under the name of its bulkhead", async () => {
    const reader = collectingReader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter("test");
    const { app } = heldApp({ probes: 0, requests: 1 }, meter);

    await app.request(PROBE_PATH);

    await expect(rejectionsBy(reader)).resolves.toStrictEqual({ probes: 1 });
  });

  it("should count no rejection when a slot is free", async () => {
    const reader = collectingReader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter("test");
    const { app } = heldApp({ probes: 1, requests: 1 }, meter);

    await app.request(PROBE_PATH);

    await expect(rejectionsBy(reader)).resolves.toStrictEqual({});
  });

  it("should keep a probe up when the request capacity is full", async () => {
    const { app, hold, release } = heldApp({ probes: 1, requests: 1 });
    const first = hold();
    await first.entered;

    const probe = await app.request(PROBE_PATH);
    release();
    await first.response;

    expect(probe.status).toBe(200);
  });

  it("should give the slot back when the request ends", async () => {
    const { app, hold, release } = heldApp({ probes: 1, requests: 1 });
    const first = hold();
    await first.entered;
    release();
    await first.response;

    const response = await app.request("/held");

    expect(response.status).toBe(200);
  });

  it("should give the slot back when the handler throws", async () => {
    const { app } = heldApp({ probes: 1, requests: 1 });
    await app.request("/fail");

    const response = await app.request("/fail");

    expect(response.status).toBe(500);
  });

  it("should always admit exactly the limit when more requests are in flight", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ max: 32, min: 1 }),
        fc.integer({ max: 32, min: 0 }),
        async (limit, extra) => {
          const { hold, release } = heldApp({ probes: 1, requests: limit });
          const admitted = Array.from({ length: limit }, hold);
          await Promise.all(admitted.map(async (held) => held.entered));

          const rejected = Array.from({ length: extra }, hold);
          const rejectedStatuses = await Promise.all(rejected.map(statusOf));
          release();
          const admittedStatuses = await Promise.all(admitted.map(statusOf));

          expect(admittedStatuses).toStrictEqual(
            Array.from({ length: limit }, () => 200)
          );
          expect(rejectedStatuses).toStrictEqual(
            Array.from({ length: extra }, () => 503)
          );
        }
      )
    );
  });
});
