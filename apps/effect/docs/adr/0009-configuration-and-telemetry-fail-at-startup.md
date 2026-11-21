---
status: accepted
---

# Configuration and telemetry fail at startup

Every value from the environment is an Effect `Config`, read when the layer that needs it builds. A missing or malformed value fails startup with a typed `ConfigError`. Nothing throws during an import, so the tests need no environment. This ADR extends [ADR-0002](./0002-observability-is-an-effect-layer-not-a-preload.md).

These records came from code comments. [ADR-0006 in the root](../../../../docs/adr/0006-code-has-no-comments.md) moved them here.

## Configuration (`src/shared/config.ts`)

- **`PORTLESS_URL` wins over `APP_URL`.** portless injects it with the worktree subdomain prefix, which is more accurate than the env file.
- **`PORT` has a default.** portless sets it, but a developer also runs `dev:server` and `node:dev:server` directly. Without a default that is a startup `ConfigError`.
- **`OTEL_EXPORTER_OTLP_ENDPOINT` is a `Config`.** The OTLP exporters read it from `process.env` themselves, so a missing or misspelled value drops every span with no error. As a `Config`, it fails startup. `apps/hono` makes the same variable required.
- **`OTEL_LOG_LEVEL` is a `Config` with the `DiagLogLevel` names.** `@effect/opentelemetry` builds the providers itself and does not run `@opentelemetry/sdk-node`, which reads this variable. `observability.ts` therefore registers the `diag` logger. Without it the SDK logger is a no-op at `INFO`, and an exporter that cannot reach the collector says nothing. `diag` is process-global, so it is set when the layer builds, not at import.
- **The OpenAPI title and version come from `package.json`** (`src/shared/metadata.ts`). Annotations are plain values at module load. A `Config` would make the API description an `Effect` that a client cannot share. The service name and version of telemetry come from the same place.

## Telemetry (`src/server/observability.ts`)

- **Import `@effect/opentelemetry/NodeSdk`.** Since 4.1 the package root does not export `NodeSdk` or `WebSdk`, so that the root does not load the optional trace SDK peers. Bun implements `AsyncLocalStorage`, so `NodeSdk` serves both entrypoints and there is no `WebSdk`.
- **The per-signal URLs are concatenated.** An explicit exporter `url` is used verbatim, so the code appends `/v1/traces` and the other paths. `new URL(path, base)` treats a base without a trailing slash as a file and turns `http://collector/otlp` into `http://collector/v1/traces`.
- **No sampler, so parent-based always-on.** `server/probes.ts` already drops the probe spans (ADR-0008), which is head filtering and cheaper than a sampler. Add sampling first if traffic grows.
- **`app` does not provide the layer.** The entrypoints do. Tests drive `app` with no env file and get the default no-op tracer.
- **The log and span processors take different argument forms** (an options bag against a positional exporter). The two SDK packages differ.

## Entrypoints (`src/app/main.ts`, `node.ts`, `bun.ts`)

- **`main.ts` holds everything that is the same on both runtimes.** `node.ts` and `bun.ts` hold only the platform server and the runtime. A copy that drifts fails quietly: without `tracerDisabledForProbes`, one runtime traces the probes, and no test runs an entrypoint.
- **The tracer is not passed to `serve`.** `HttpEffect.toHandled` applies `HttpMiddleware.tracer` already, so the server span encloses the per-request log line. Passing it through the `middleware` option adds a second, nested span. This was verified against a collector.
- **Telemetry is `Layer.provide`d, not merged.** It builds first and releases last, so spans and log records from shutdown are flushed.
- **`runMain` installs SIGINT and SIGTERM handling, and `Layer.launch` runs the finalizers.** There is no hand-written shutdown code.
- **The banner logs the public portless URL.** `HttpServer.withLogAddress` logs the bound socket, but portless terminates TLS on a `.localhost` subdomain and forwards to it.

## Request metric (`src/server/metrics.ts`)

- **`http.server.request.duration` in seconds, with the bucket boundaries of the OpenTelemetry semantic conventions.** A dashboard built elsewhere reads it without configuration. `Metric.timer` records milliseconds under a `time_unit` attribute, which prebuilt OTLP dashboards ignore. Generated boundaries that are nearly right render wrongly.
- **No separate request counter.** A histogram carries its own `count`.
- **No `http.route` attribute.** The label must be the matched template, never `/users/42`. This middleware runs outside `HttpApiBuilder` routing, where only the raw path is known, so a path label explodes cardinality at the first `/users/:id`. Per-path analysis uses the `url.path` of the server span. If a route breakdown is needed, record inside `HttpApiBuilder`.
- **`requestAttributes` is the only writer of the attribute keys**, for the same series-key reason as `probeAttributes` (ADR-0008). It and `requestDuration` are exported so that a test reads the series back.
- **The status attribute is a string.** Effect metric attributes are strings. The convention types `http.response.status_code` as an integer, so a strict backend sees a string label.
- **`recordRequest` is not exported.** A fresh `Metric.MetricRegistry`, merged into the layer of `toWebHandler` with `Layer.provideMerge`, reaches every request fiber. The middleware is asserted where it runs, in `tests/middleware.test.ts`. The conversion from milliseconds to seconds is in this one place.
- **It records only on success.** `onError` and `notFound` are innermost, so every response made on purpose reaches it as a success value with its real status.
