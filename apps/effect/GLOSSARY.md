# Effect HTTP API

The Effect v4 HTTP API app. It answers three health probes, serves its own OpenAPI document, and exports what it observes about itself as OpenTelemetry traces, metrics and log records.

## Language

### Health

**Probe**: One of the three health routes, taken together as a kind. Declared once — its path segment, its endpoint id, and whether it is traced — because those three facts are read by three different modules and used to be written in five places. What a Probe answers is a Health Report; whether one call passed is a Probe Outcome. _Avoid_: healthcheck, endpoint

**Startup Probe**: The claim that the process has finished booting. Distinct from a Liveness Probe because a caller that reads it suspends the liveness clock until it passes, so a slow boot is not a wedged process. _Avoid_: boot check, warmup

**Liveness Probe**: The claim that the process is not wedged. Its failure means "restart me". _Avoid_: healthcheck, ping, heartbeat

**Readiness Probe**: The claim that the process can serve traffic. Its failure means "stop routing to me", never "restart me" — that difference is the reason it is not the Liveness Probe. _Avoid_: healthcheck, availability check

**Health Report**: What a probe answers with: an overall status plus the Checks behind it. The same shape on success and on failure, so which dependency broke is said in the body rather than inferred from a status code. _Avoid_: health status, health response

**Check**: One named condition a Readiness Probe evaluates — a dependency the app needs before it can serve. A Startup Probe and a Liveness Probe have none. _Avoid_: probe, healthcheck, test

### Signals

**Metric**: An aggregate this app records about itself and exports over OTLP — a counter or a histogram. Effect's `Metric` module, never the `Server-Timing` header. _Avoid_: metrics (plural, as a name), measurement, telemetry

**Server Timing**: The total time a response took, reported to its own caller in the `Server-Timing` response header. Client-facing and per-request, where a Metric is aggregate and exported — which is why it does not share the word. The total is the only entry: no handler in this app records a duration of its own. _Avoid_: metrics, timings

**Probe Outcome**: Whether one probe call passed or failed, counted as a Metric rather than traced or logged. Probes are called too often, and say the same thing too reliably, to be worth one event each. _Avoid_: probe result event, health event

**Probe Silence**: The rule that a probe call makes no event of its own — no per-request log line for any of the three, and no spans for the Startup Probe and the Liveness Probe. A deployment calls each one about once a second, and they answer the same thing, so an event each says nothing a Probe Outcome does not say better. The Readiness Probe keeps its span: it runs the Checks, so its span describes work. Which of the three that is, is declared on the Probe and not in the module that applies the rule. _Avoid_: probe filtering, log suppression

### Security

**Allowed Origin**: The one origin this app trusts, derived from `APP_URL` by taking its origin — scheme, host and port, with no trailing slash, because that is what a browser puts in `Origin`. Two policies read it and neither owns it: CORS decides who may read a response, CSRF decides whose state-changing request is honoured. See [`apps/effect/docs/adr/0003`](./docs/adr/0003-cors-and-csrf-stay-separate-layers.md) for why those two stay separate. _Avoid_: allowed host, app url, base url

### Failures

The three failure classes. See [ADR-0007](../../docs/adr/0007-failures-have-three-classes.md).

**Refusal**: A failure because the request is not correct. Status 400–499, logged at `info`. The body tells the client the `location` and a `fix`. _Avoid_: client error, bad request (as a class name)

**Infrastructure Fault**: A failure because a dependency failed or the server stopped the request. Status 502, 503 or 504, logged at `warn`. The same request can succeed later. _Avoid_: server error, outage

**Outcome Unknown**: The result of an outbound call that did not answer in time: the remote action possibly occurred. It is one cause of an Infrastructure Fault (504), not a Refusal. See [ADR-0009](../../docs/adr/0009-resilience-policy.md). _Avoid_: failed, refused, timeout error

**Defect**: A failure because of a bug. Status 500, logged at `error`. The body never shows the defect message. _Avoid_: crash, exception

### Server

**Middleware Chain**: The twelve global middleware this app wraps its router in, declared as one ordered tuple in `src/app/chain.ts` and folded once. The order is the whole of what it is: registration order is nesting order, and nesting decides what a response that never reaches the router carries out — a cors preflight leaves with no timings, a csrf 403 leaves with everything. Stated once because the count in prose drifted when it was not. _Avoid_: middleware stack, pipeline, the middlewares

**Admission Control**: The limit on the number of requests in flight. A request takes one slot when it arrives and gives it back when its handler ends. When no slot is free, the app sheds the request. See [ADR-0009](../../docs/adr/0009-resilience-policy.md#admission-control-bulkheads-and-backpressure). _Avoid_: rate limiting, throttling

**Bulkhead**: A separate set of slots for one kind of request, so that a full app does not stop it. The Probes have a Bulkhead. _Avoid_: pool, partition

**Shed**: To refuse a request because no slot is free: `503` with `Retry-After`, before the handler runs. A shed request is an Infrastructure Fault. _Avoid_: drop, reject (as the name of this act)
