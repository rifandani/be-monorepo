# Observability

Decisions and rejected alternatives: [`docs/adr/0002`](./adr/0002-observability-is-an-effect-layer-not-a-preload.md).

## Signals

- **Traces** — `HttpMiddleware.tracer` opens a server span per request, honours inbound `traceparent`. `Effect.fn("Name")` spans nest under it.
- **Metrics** — two:

  | Metric | Type | Attributes | Module |
  | --- | --- | --- | --- |
  | `http.server.request.duration` | histogram, **seconds** | `http.request.method`, `http.response.status_code` | `src/server/metrics.ts` |
  | `health.probe.result` | counter | `probe`, `outcome` | `src/server/health.ts` |

- **Logs** — `OtelLogger` turns every `Effect.log*` into an OTLP record, with `traceId`, `spanId` and every `Effect.annotateLogs` annotation attached. So `requestId` and the trace id land on one record; correlation needs no code.

## Gotchas

- **Never wire the tracer.** `HttpEffect.toHandled` applies it already, below `serve`. Passing it through `serve`'s `middleware` option adds a **second, nested** span per request — measured against a collector.
- **Quietening a probe takes two mechanisms.** `tracerDisabledForProbes` stops the *server* span, but the handler's own `Effect.fn("Health.live")` span then exports as a **root** span instead of not at all; `Effect.withTracerEnabled(false)` in `quietProbes` is what makes it zero. Effect's `layerTracerDisabledForUrls` compares whole urls, so `/health/live?x=1` slips past it — hence `pathOf`.
- **Attribute insertion order keys the series** — `JSON.stringify(Object.entries(attributes))`, so `{ method, status }` and `{ status, method }` are two series with half the traffic each. Build metric attributes only through `requestAttributes` / `probeAttributes`.
- **Tests need a fresh `Metric.MetricRegistry` `Map` per run.** A read and the update it reads must share one registry, and the reference's default is one `Map` shared process-wide — a count against it depends on file order.