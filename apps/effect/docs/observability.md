# Observability

What this app emits, where it goes, and what it deliberately does not emit.

The decisions below and the alternatives rejected to reach them are in
[`docs/adr/0002`](./adr/0002-observability-is-an-effect-layer-not-a-preload.md).
The vocabulary — the three probes, and why a **Metric** is not a **Server
Timing** — is in [`CONTEXT.md`](../CONTEXT.md).

## Layout

| File | What it holds |
| --- | --- |
| `src/observability.ts` | The `NodeSdk` layer: one exporter per signal, the resource, no sampler |
| `src/server/metrics.ts` | The two metrics, the attribute helpers, and the request middleware |
| `src/server/probes.ts` | Which probe is logged, which is traced, and both mechanisms that quieten them |
| `src/server/health.ts` | The three probes' answers, and the readiness checks |
| `src/config.ts` | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOG_LEVEL` |

## The signals

**Traces.** `HttpMiddleware.tracer` opens a server span per request, honouring an
inbound `traceparent`, and records `http.request.method`, `url.path`,
`url.scheme`, `user_agent.original`, `client.address` and
`http.response.status_code`. Effect's `Effect.fn("Name")` spans nest under it, so
`Health.ready` and each `Health.runCheck` appear as children.

**Nothing wires the tracer, and nothing should.** `HttpRouter.serve` composes
only `HttpMiddleware.logger` into the middleware it hands down, which reads like
the tracer being opt-in. One level lower, `HttpEffect.toHandled` — which every
platform `serve` goes through — applies the tracer itself and wraps the
middleware with it (`tracer(middleware(responded))`). So the span already
encloses Effect's own per-request log line, and that line already carries a trace
id. It still carries no request id, for the reason `http-api.md` gives.

Passing `HttpMiddleware.tracer` through `serve`'s `middleware` option therefore
adds a **second, nested** `http.server GET` span to every request. This app did
that at first and a collector showed the duplicate.

**Metrics.** Two, and no more:

| Metric | Type | Attributes |
| --- | --- | --- |
| `http.server.request.duration` | histogram, **seconds** | `http.request.method`, `http.response.status_code` |
| `health.probe.result` | counter | `probe`, `outcome` |

The name, unit and bucket boundaries of the first are the OpenTelemetry semantic
convention's, so a dashboard built elsewhere reads it without being told
anything. `Metric.timer` was the shorter way to write it and records
milliseconds under a `time_unit` attribute, which those dashboards ignore.

There is no request counter: a histogram carries its own `count`.

There is no `http.route` attribute. A route label has to be the matched template
(`/users/{id}`, never `/users/42`) and the middleware runs outside
`HttpApiBuilder`'s routing, where only the raw path is known. Per-path analysis
lives in the traces, where the span records `url.path`.

**A series is keyed by the insertion order of its attributes** —
`JSON.stringify(Object.entries(attributes))` — so `{ method, status }` and
`{ status, method }` are two series with half the traffic each. That is why
`requestAttributes` and `probeAttributes` exist and why nothing else builds those
records by hand.

**Logs.** `OtelLogger` turns every `Effect.log*` call into an OTLP log record. It
attaches `traceId` and `spanId` when a span is in scope, plus every
`Effect.annotateLogs` annotation — so `requestId` from
`src/server/request-id.ts` lands on the same record as the trace id, and
correlation needs no code of ours.

**Note for Grafana:** those ids are log record *attributes*, not the record's
native trace-context fields. The Loki → Tempo jump therefore needs a derived
field named `traceId` on the Loki datasource. Nothing is broken if it is missing;
the link is just absent.

## Probes are metered, not traced or logged

A deployment polls each probe about once a second. Left alone the three would be
roughly a quarter of a million spans and a quarter of a million log lines a day,
all reporting that the process is fine.

- `src/server/probes.ts` drops the per-request log line for all three.
- It drops **every** span for `/health/startup` and `/health/live`.
  `/health/ready` keeps its span: it runs the readiness checks, so it is the only
  one whose span describes anything.

  That takes two mechanisms, and only one of them is obvious.
  `tracerDisabledForProbes` provides `HttpMiddleware.TracerDisabledWhen`, which
  stops the *server* span — opened outside the router, before any middleware in
  `app` runs. But the handler's own `Effect.fn("Health.live")` span is opened
  inside, and with the server span gone it was exported as a *root* span rather
  than not at all: measured against a collector, a liveness poll still sent one
  span. `Effect.withTracerEnabled(false)` in `quietProbes` is what makes it zero.
  Effect's `layerTracerDisabledForUrls` is not used either: it compares whole
  urls, so `/health/live?x=1` would slip past it.
- `health.probe.result` counts every call either way, which answers "how many
  readiness failures in the last hour" better than a quarter million events do.

This is head filtering — the span is never created. That is strictly cheaper than
sampling, which builds a span before deciding, and it is why this app configures
no sampler at all. Sampling is the first knob to reach for if the app ever serves
real volume.

A failure is still logged in full: `src/server/error.ts` writes that line itself,
from inside the chain.

## The health probes

Three endpoints, because the three answers mean different things to whoever
polls them. There is deliberately no bare `/health`.

| Path | Meaning | Failure means |
| --- | --- | --- |
| `/health/startup` | Booting finished | Keep waiting; do not start the liveness clock |
| `/health/live` | The process is not wedged | Restart me |
| `/health/ready` | Traffic can be served | Stop routing to me — **not** restart me |

All three answer with the same `HealthReport` body, and `/health/ready` answers
`503` with the same shape when a check fails. Which dependency broke is said in
the body, not inferred from the status code; why it broke is logged, not
returned. See `src/domain/health.ts`.

`READINESS_CHECKS` in `src/server/health.ts` is **empty**, because this app has
no database, no cache and no upstream service. Add the check there the day there
is one, and the readiness probe starts answering 503 while it is down with no
other change. `makeHealth` takes its checks by parameter so a test can reach the
failing path an app with no dependencies cannot otherwise produce.

## Configuration

`OTEL_EXPORTER_OTLP_ENDPOINT` is **required** and read as an Effect `Config`, so
a missing or misspelled value fails startup with a `ConfigError` rather than
silently dropping every span. The exporters would have read it from
`process.env` themselves; that is exactly the silence being avoided.

`.env.dev` and `.env.prod` point at `http://localhost:4318`, the OTLP/HTTP port
`docker/docker-compose.yml` already publishes from `grafana/otel-lgtm`. Grafana
is on `http://localhost:3111`.

```sh
docker compose -f docker/docker-compose.yml up otel-lgtm
```

`OTEL_LOG_LEVEL` is **required** too, and one of `ALL`, `VERBOSE`, `DEBUG`,
`INFO`, `WARN`, `ERROR`, `NONE` — `DiagLogLevel`'s own names, so the value is the
one `apps/hono` validates and every OpenTelemetry SDK reads. It sets how loud the
SDK is about *its own* problems, such as an exporter that cannot reach the
collector; it does not filter the application's `Effect.log*` records.
`@opentelemetry/sdk-node` reads this variable in its constructor, and `apps/hono`
gets it that way; `@effect/opentelemetry` builds the providers directly and
starts no `NodeSDK`, so `src/observability.ts` registers the console diag logger
itself when the layer is built.

Nothing else is declared. The service name and version come from
`src/metadata.ts` — that is, from `package.json` — and everything else about the
SDK is left to its own environment handling.

## Under the tests

`app` provides no telemetry, so `vitest` — which runs with no env file and drives
`app` through `toWebHandler` — reaches no collector and gets Effect's default
no-op tracer. A test that wants to assert on spans provides its own in-memory
tracer layer.

A metric read and the update it reads have to happen under one
`Metric.MetricRegistry`, and that reference's default is one `Map` shared by
every test in the process. `src/server/metrics.test.ts` and
`src/server/health.test.ts` therefore provide a fresh `Map` per run; a count
asserted against the default registry would depend on which file ran first.

## Bun

`src/bun.ts` uses the same `NodeSdk` layer. It needs `AsyncLocalStorage`, which
Bun implements, so there is no `WebSdk` here and no per-runtime fork of the
configuration. Both entrypoints call `main` from `src/main.ts`, which holds the
whole composition — router, probe tracer exclusion, telemetry, banner — and takes
only the platform server layer, so neither runtime can drift from the other.
