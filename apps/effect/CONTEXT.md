# Effect HTTP API

The Effect v4 HTTP API app. It answers three health probes, serves its own OpenAPI document, and exports what it observes about itself as OpenTelemetry traces, metrics and log records.

## Language

### Health

**Startup Probe**: The claim that the process has finished booting. Distinct from a Liveness Probe because a caller that reads it suspends the liveness clock until it passes, so a slow boot is not a wedged process. _Avoid_: boot check, warmup

**Liveness Probe**: The claim that the process is not wedged. Its failure means "restart me". _Avoid_: healthcheck, ping, heartbeat

**Readiness Probe**: The claim that the process can serve traffic. Its failure means "stop routing to me", never "restart me" — that difference is the reason it is not the Liveness Probe. _Avoid_: healthcheck, availability check

**Health Report**: What a probe answers with: an overall status plus the Checks behind it. The same shape on success and on failure, so which dependency broke is said in the body rather than inferred from a status code. _Avoid_: health status, health response

**Check**: One named condition a Readiness Probe evaluates — a dependency the app needs before it can serve. A Startup Probe and a Liveness Probe have none. _Avoid_: probe, healthcheck, test

### Signals

**Metric**: An aggregate this app records about itself and exports over OTLP — a counter or a histogram. Effect's `Metric` module, never the `Server-Timing` header. _Avoid_: metrics (plural, as a name), measurement, telemetry

**Server Timing**: The per-request durations this app reports to its own caller in the `Server-Timing` response header. Client-facing and per-request, where a Metric is aggregate and exported — which is why it does not share the word. _Avoid_: metrics, timings

**Probe Outcome**: Whether one probe call passed or failed, counted as a Metric rather than traced or logged. Probes are called too often, and say the same thing too reliably, to be worth one event each. _Avoid_: probe result event, health event
