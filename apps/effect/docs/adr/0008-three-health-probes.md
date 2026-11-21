---
status: accepted
---

# Three health probes, counted and not traced

The app answers three Probes: startup, liveness and readiness. `GLOSSARY.md` defines each term. `PROBES` in `src/features/health/api.ts` is the one statement of a Probe: the group builds each endpoint from `segment`, `server/probes.ts` builds both exclusion sets from `path` and `traced`, and the Probe Outcome counter keys on the record key.

These records came from code comments. [ADR-0006 in the root](../../../../docs/adr/0006-code-has-no-comments.md) moved them here.

## Three endpoints, no bare `/health`

The three answers mean different things to the caller. A startup probe suspends the liveness clock. A liveness failure restarts the process. A readiness failure only removes it from the pool. A single `/health` would answer "whichever of them you assumed", so there is no bare `/health`.

- **Startup** answers unconditionally. The layer built, so configuration resolved and every dependency was acquired. A flag that flips would be a second, less trustworthy account of the same fact.
- **Liveness** answers unconditionally, and that is correct, not a stub. A liveness failure means "restart me", and a restart does not fix a dependency that is down. A wedged event loop cannot answer at all, which is the failure this probe detects.
- **Readiness** runs every Check concurrently and reports every result, so the body names all failures, not only the first. The operator reading the body wants the whole list.

Startup and liveness have no checks by definition, so their report is built once. An empty `checks` array is not a placeholder.

## The contract

- **`Unhealthy` is a 503, not a 500 and not a 200.** `httpApiStatus` makes it a 503. A caller must tell "do not route to me" from "I am broken", because the first is not a reason to restart. A 200 with a bad status in the body defeats every consumer that reads only the status code.
- **`Unhealthy` is declared only on `ready`.** The other two report on the answering process, so a failure they report would also stop them answering.
- **One declaration of the checks list** serves the success body and `Unhealthy`, so the two cannot drift. Which dependency broke is in the body, not inferred from the status code.
- **`Unhealthy.status` is pinned to `"unhealthy"`.** Sharing the wider `"ok" | "unhealthy"` would make `new Unhealthy({ status: "ok" })` constructible.
- **Only the name and the outcome cross the wire.** Why a check failed goes to the log, as for every server failure (ADR-0006).
- **`Segment` is generic and `const`.** `HttpApiEndpoint.get` takes `const Path extends PathInput`, and a plain `string` field widens past that.
- **The three `.add` calls are written out.** A fold over `PROBES` collapses three endpoints into one union and loses the `Api` types; `ready` alone declares an error. A Probe with no `.add` compiles and is not served, so the mount cases in `tests/app.test.ts` iterate `PROBES` to catch it.
- **No `id` field and no `logged` field.** The record key is the id, and `probe` is `keyof typeof PROBES`, so a fourth entry makes the handler map in `app/health.ts` fail to compile until its handler exists. No probe gets a per-request log line, so a `logged` field would hold one value three times.

## Checks

- **`READINESS_CHECKS` is empty** because this app has no database, cache or upstream service. Add the database check there when a database exists. Readiness then answers 503 while it is down, with no other change.
- **`verify` failing is the check failing.** A check that throws dies, so `catchCause` runs it, not `catch`. A probe that cannot answer because a client threw is worse than a 503.
- **`Health.make` takes its checks by parameter.** With nothing to check, readiness always answers "ok", and the failing path is reachable only from a test.
- **`Layer.sync`, not `Layer.effect`.** Checks are declarations and acquire what they need when they run. A check that needs a pooled client makes this `Layer.effect`.

## Counted, not traced

A deployment polls each probe about once a second. Traces and log lines for them are about a quarter of a million near-identical events a day. The `health.probe.result` counter replaces them.

- **Liveness and startup keep no span.** Answering is the signal, so a span says only what the response says. **Readiness keeps its spans**, because it runs the Checks and its span describes work.
- **Two mechanisms are necessary.** `TracerDisabledWhen` stops the server span, and `withTracerEnabled(false)` stops the spans that the handler opens. The platform tracer reads the predicate outside the router, so app composition must provide it to the server as well as install `quietProbes`. `docs/observability.md` has the details. Server infrastructure does not own the feature paths or the tracing decision; app composition supplies them.
- **`probeAttributes` is the only place that writes the attribute keys.** A series is keyed by `JSON.stringify(Object.entries(attributes))`, so `{ probe, outcome }` and `{ outcome, probe }` are two series with half the traffic each. `outcome` is the report `status`, so it cannot drift from the response.
