---
status: accepted
---

# Observability is an Effect layer, not a preload

`apps/effect` installs OpenTelemetry as `@effect/opentelemetry`'s `NodeSdk.layer`,
provided by the two entrypoints, and **not** as a preloaded `NodeSDK` the way
`apps/hono` does (`src/instrumentation.ts`, loaded through `--preload` / `--import` in
every dev script). Traces, metrics and log records therefore reach OTLP because Effect's
own `Effect.fn` spans, `Metric` values and `Effect.log*` calls are wired to it by a
layer, with no bridging code and no second logging library.

> This app's ADR numbering starts at `0002`. The repo's root
> [`docs/adr/0001`](../../../../docs/adr/0001-unit-tests-are-pure-module-logic-and-api-routes-only.md)
> cites an `apps/effect/docs/adr/0001-effect-native-stack-over-the-hono-app-conventions.md`
> that was never written. `0001` is left free for it rather than taken under a different
> title, which would make that citation resolve to a document about something else.

## Considered options

**A preload, mirroring `apps/hono`.** Rejected, for now. The one thing a preload buys
that a layer cannot is auto-instrumentation of libraries that hook module loading —
`@opentelemetry/instrumentation-pg` is why `apps/hono` needs one. This app has no
database and makes no outbound HTTP calls, so it has nothing to auto-instrument, and
the preload would exist only to start an SDK that a layer starts anyway. It also costs
the layer's shutdown semantics: `apps/hono` hand-rolls `shutdownObservability()`, while
`NodeSdk.layer` flushes and shuts the providers down in an `Effect.acquireRelease`
finalizer that `Layer.launch` already runs on `SIGINT`/`SIGTERM`.

**Consequence, and the trigger to revisit:** the day this app gains a database or an
outbound HTTP client, a preload comes back — but only for the instrumentations, beside
the layer, not instead of it.

**A second logging library.** `apps/hono` uses `evlog` for logs and OTel for traces and
metrics. Rejected here: `OtelLogger` turns `Effect.log*` into OTLP log records directly,
and it already attaches `traceId`, `spanId` and every `Effect.annotateLogs` annotation —
so the existing `requestId` annotation lands on the same record as the trace id with no
work. A second library would be a second place logs come from.

**`WebSdk` for the Bun entrypoint.** Rejected, and since verified: `src/bun.ts` was
run against a collector and exported the same spans as `src/node.ts`, with the probe
exclusions intact. `NodeSdk` needs `AsyncLocalStorage`, which Bun implements, so both
entrypoints share one `src/observability.ts` and there is no per-runtime fork.

**The package barrel.** `import { NodeSdk } from "@effect/opentelemetry"` does not work
here and the failure is worth recording, because the fix looks like a style choice.
That index re-exports `WebSdk`, which imports `@opentelemetry/sdk-trace-web` — a peer
this app has no reason to install — so the barrel import fails at startup with
`ERR_MODULE_NOT_FOUND` for a module nothing uses. `src/observability.ts` imports the
`@effect/opentelemetry/NodeSdk` subpath instead.

## Decisions this records

- **The tracer sits outside the router and needs no wiring.** `HttpEffect.toHandled`,
  which every platform `serve` goes through, applies `HttpMiddleware.tracer` itself, so
  the server span *encloses* Effect's own per-request log line and that line carries a
  trace id. Passing the tracer through `serve`'s `middleware` option as well produces a
  second, nested server span per request — verified against a collector. What the
  entrypoints do provide is `tracerDisabledForProbes`, the reference that tracer reads;
  it is composed once in `src/main.ts`, which both entrypoints call.
- **Probes are metered, not traced or logged.** A Kubernetes deployment calls the three
  probes about once a second each: ~260k spans and ~260k log lines a day, all saying
  "ok". `layerTracerDisabledForUrls` drops spans for the Startup and Liveness Probes
  (the Readiness Probe keeps its span — it is the only one that does work), and the
  per-request log line is disabled for all three. The information is not lost, it moves
  to a `health.probe.result` counter. Head filtering, not sampling: the span is never
  created.
- **No sampling.** Parent-based always-on, matching `apps/hono`. With the probes already
  filtered out there is nothing left worth sampling. Sampling is the first knob to reach
  for at real volume.
- **Metric names follow OTel semantic conventions, not Effect's ergonomics.**
  `http.server.request.duration` as a `Metric.histogram` in **seconds** with the semconv
  bucket set — not `Metric.timer`, which records milliseconds and stamps
  `time_unit: "milliseconds"`. The point of exporting over OTLP is that something
  downstream already knows what the metric means; a differently named metric in
  different units is one every prebuilt dashboard ignores. No separate request counter:
  a histogram carries its own count.
- **The request metric carries no route label.** Attributes are
  `http.request.method` and `http.response.status_code` only. `http.route` must be the
  matched template, and the middleware runs outside `HttpApiBuilder`'s routing, where
  only the raw path is known. Labelling with the raw path is safe for today's static
  paths and becomes a cardinality explosion the first time someone adds `/users/:id`.
  Per-path analysis lives in traces, where the server span already records `url.path`.
  Recording the metric inside `HttpApiBuilder`, where the endpoint name is known, is the
  honest fix if a route breakdown is ever needed.
- **Telemetry stays out of `app`.** The entrypoints provide it; `app` is
  transport- and exporter-free. So `vitest`, which runs with no env file and drives `app`
  through `toWebHandler` and, in `tests/platform.test.ts`, over a real socket, gets
  Effect's default no-op tracer either way and reaches no collector.
- **`Layer.provide(server, observability)`, not `Layer.merge`.** Telemetry builds first
  and releases last, so spans and log records emitted while the process is shutting down
  are still flushed.
- **The OTLP endpoint is an Effect `Config`, not left to the SDK's env lookup.** The
  exporters would read `OTEL_EXPORTER_OTLP_ENDPOINT` from `process.env` themselves, and a
  missing or misspelled value would be silent — spans dropped, no error. As a `Config` it
  is a `ConfigError` at startup, which is the property `src/config.ts` exists to hold.
  Everything else is left to the SDK's own env handling, and the resource attributes come
  from `src/metadata.ts` (that is, `package.json`) rather than being re-declared.
- **`OtelLogger` reports trace ids as attributes, not as the log record's native trace
  context.** Grafana's Loki → Tempo jump therefore needs a derived field named `traceId`.
  Forking a vendored release-candidate module to set the native field is not worth a
  datasource configuration line.

## Vocabulary

The Startup / Liveness / Readiness Probe split, and the deliberate separation of
**Metric** (aggregate, exported) from **Server Timing** (per-request, client-facing), are
defined in [`CONTEXT.md`](../../CONTEXT.md). The second of those is why
`src/server/timing.ts` renames its `Metrics` reference to `ServerTiming`: two unrelated
things called `Metrics` under `src/server/` is the ambiguity this app is now large enough
to have to avoid.
