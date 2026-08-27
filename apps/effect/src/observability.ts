// The subpath and not the package barrel. `@effect/opentelemetry`'s index
// re-exports `WebSdk`, which imports `@opentelemetry/sdk-trace-web` — a peer
// this app does not install, because it does not serve a browser. Importing the
// barrel therefore fails at startup with `ERR_MODULE_NOT_FOUND` for a module
// nothing here uses.
import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";

import { OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOG_LEVEL } from "./config.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "./metadata.ts";

/**
 * The endpoint the per-signal urls below are built on, with any trailing slash
 * removed.
 *
 * The exporters would append `/v1/traces` and the rest themselves if they were
 * left to read the endpoint from the environment, but they are given an explicit
 * `url` here — see `OTEL_EXPORTER_OTLP_ENDPOINT` in `config.ts` for why the
 * value comes from a `Config` — and an explicit `url` is used verbatim. So the
 * suffix goes on here.
 *
 * String concatenation and not `new URL(path, base)`: `new URL` treats a base
 * without a trailing slash as a file and would turn
 * `http://collector/otlp` into `http://collector/v1/traces`, silently dropping
 * the path a gateway was mounted under.
 */
const signalBase = (endpoint: URL): string =>
  endpoint.toString().replace(/\/+$/u, "");

/**
 * The SDK's own diagnostics, sent to the console at the configured level.
 *
 * `@opentelemetry/sdk-node` does this from `OTEL_LOG_LEVEL` in its constructor,
 * and `apps/hono` gets it that way. `@effect/opentelemetry` builds the
 * providers directly and starts no `NodeSDK`, so without this call the level is
 * `INFO` on a logger that is a no-op, and an exporter that cannot reach the
 * collector says nothing at all.
 *
 * `diag` is process-global, so this runs where the layer is built and not at
 * import time — the tests import `app`, never this module, and so leave the
 * global alone.
 */
const setDiagLogger = (level: keyof typeof DiagLogLevel): void => {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel[level]);
};

/**
 * OpenTelemetry, as a layer.
 *
 * All three signals, wired to Effect's own: `Effect.fn` spans and the server
 * span become OTLP spans, `Metric` values are exported by a producer the reader
 * polls, and `Effect.log*` becomes OTLP log records carrying `traceId`,
 * `spanId` and every `Effect.annotateLogs` annotation — which is what puts the
 * trace id and the request id on the same line, with no correlation code of our
 * own.
 *
 * A layer and not the preloaded `NodeSDK` that `apps/hono` starts in
 * `src/instrumentation.ts`. `docs/adr/0002` argues that at length; the short
 * version is that a preload buys auto-instrumentation of libraries that hook
 * module loading, this app has none of those, and a layer's finalizer flushes
 * and shuts the providers down where the preload needs a hand-rolled
 * `shutdownObservability()`.
 *
 * No sampler, so parent-based always-on. The traffic worth not tracing is
 * already gone — `server/probes.ts` drops the spans for the two probes that
 * would say nothing, which is head filtering and strictly cheaper than a
 * sampler that has to build a span before deciding. Sampling is the first knob
 * to reach for if this ever serves real volume.
 *
 * `Effect` and not a plain thunk, because the endpoint is a `Config`: the layer
 * therefore carries a `ConfigError`, and a collector that was never configured
 * fails startup instead of dropping every span in silence.
 *
 * Not provided by `app`, and this is deliberate. The entrypoints provide it, so
 * `app` stays free of exporters and `vitest` — which runs with no env file and
 * drives `app` through `toWebHandler` — reaches no collector and gets Effect's
 * default no-op tracer.
 */
export const observability = NodeSdk.layer(
  Effect.gen(function* telemetry() {
    const base = signalBase(yield* OTEL_EXPORTER_OTLP_ENDPOINT);

    setDiagLogger(yield* OTEL_LOG_LEVEL);

    return {
      resource: {
        serviceName: SERVICE_NAME,
        serviceVersion: SERVICE_VERSION,
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${base}/v1/traces` })
      ),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${base}/v1/metrics`,
        }),
      }),
      // An options bag, where `BatchSpanProcessor` above takes its exporter
      // positionally. The two SDK packages differ; this is not a slip.
      logRecordProcessor: new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
      }),
    };
  })
);
