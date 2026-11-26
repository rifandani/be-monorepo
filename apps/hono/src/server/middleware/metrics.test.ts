import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { DataPoint } from "@opentelemetry/sdk-metrics";
import * as fc from "fast-check";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
  failedRequestsMiddleware,
  METRIC_HTTP_SERVER_FAILED_REQUESTS,
} from "./metrics.ts";

const collectingReader = () =>
  new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 3_600_000,
  });

const meteredApp = () => {
  const reader = collectingReader();
  const meter = new MeterProvider({ readers: [reader] }).getMeter("test");
  const app = new Hono();

  app.use("*", failedRequestsMiddleware(meter));
  app.get("/ok", (c) => c.text("ok"));
  app.get("/status/:status", (c) => {
    throw new HTTPException(Number(c.req.param("status")) as 500);
  });
  app.get("/throw", () => {
    throw new Error("boom");
  });
  app.onError((error, c) =>
    error instanceof HTTPException ? error.getResponse() : c.text("failed", 500)
  );

  const failures = async (): Promise<
    readonly DataPoint<number>[] | undefined
  > => {
    const { resourceMetrics } = await reader.collect();

    const metric = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find(
        (data) => data.descriptor.name === METRIC_HTTP_SERVER_FAILED_REQUESTS
      );

    return metric?.dataPoints as readonly DataPoint<number>[] | undefined;
  };

  return { app, failures };
};

const countOf = (
  points: readonly DataPoint<number>[] | undefined,
  kind: string
): number =>
  points?.find((point) => point.attributes["error.type"] === kind)?.value ?? 0;

describe(failedRequestsMiddleware, () => {
  it("should count a 504 as failed work of the kind timeout", async () => {
    const { app, failures } = meteredApp();

    await app.request("/status/504");

    expect(countOf(await failures(), "timeout")).toBe(1);
  });

  it("should count a 503 as failed work of the kind rejected", async () => {
    const { app, failures } = meteredApp();

    await app.request("/status/503");

    expect(countOf(await failures(), "rejected")).toBe(1);
  });

  it("should count a thrown error as failed work of the kind defect", async () => {
    const { app, failures } = meteredApp();

    await app.request("/throw");

    expect(countOf(await failures(), "defect")).toBe(1);
  });

  it("should state the method of the failed request", async () => {
    const { app, failures } = meteredApp();

    await app.request("/throw");

    const [point] = (await failures()) ?? [];
    expect(point?.attributes["http.request.method"]).toBe("GET");
  });

  it("should count no failed work for a success or a refusal", async () => {
    const { app, failures } = meteredApp();

    await app.request("/ok");
    await app.request("/status/404");

    await expect(failures()).resolves.toBeUndefined();
  });

  it("should always count each failed request one time", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("/ok", "/status/504", "/throw")),
        async (paths) => {
          const { app, failures } = meteredApp();

          await Promise.all(paths.map(async (path) => app.request(path)));

          const points = await failures();
          expect(countOf(points, "timeout")).toBe(
            paths.filter((path) => path === "/status/504").length
          );
          expect(countOf(points, "defect")).toBe(
            paths.filter((path) => path === "/throw").length
          );
        }
      )
    );
  });
});
