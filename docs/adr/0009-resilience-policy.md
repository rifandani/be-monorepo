---
status: accepted
---

# Resilience policy

A call to a dependency can fail slowly, fail partially or not answer. If each handler selects its own timeouts and retries, a retry can do one action two times, and a slow dependency can hold all of the server. We decide that both API apps follow one resilience policy. This ADR is the frame of that policy. Each section is one rule. Where a lint rule can express a rule, the section names the lint rule. Code review and the tests in each section enforce the other rules.

## Sections

| Section | Problem |
| --- | --- |
| [Timeouts bound waiting](#timeouts-bound-waiting) | A call that never answers holds the caller forever |
| [Bounded retries and idempotency](#bounded-retries-and-idempotency) | Retries multiply load and can repeat a write |
| [Concurrent work has an owner and a bound](#concurrent-work-has-an-owner-and-a-bound) | Unbounded or unowned work exhausts resources and loses failures |
| [Admission control, bulkheads and backpressure](#admission-control-bulkheads-and-backpressure) | A spike makes every request slow |
| [Circuit breakers for slow dependencies](#circuit-breakers-for-slow-dependencies) | A slow dependency holds request slots on every call |
| [Golden signals: saturation and failed work](#golden-signals-saturation-and-failed-work) | Overload shows only after the server is full |
| [Retention of data that accumulates](#retention-of-data-that-accumulates) | Stores that only grow slow down and fill the disk |

## Timeouts bound waiting

A timeout stops the wait. It does not stop the remote action, and it does not prove that the remote action did not occur. The remote side can complete the action when the caller does not wait any more. Because of this, a timeout result is "outcome unknown", not "failed".

This also applies to a client of these apps. When the server answers 504 because of the inbound timeout, the handler can still complete its work. For the client, the outcome is unknown.

### Outcome unknown is its own error

- When an outbound call times out, the result is a tagged error that means "outcome unknown". In `apps/effect` this is `OutcomeUnknown` in `apps/effect/src/server/timeout.ts`. It contains the `operation` name.
- `OutcomeUnknown` is not a refusal. A refusal means that the remote side rejected the action, so the action did not occur. Do not put the two in one error type, and do not map one to the other.
- `OutcomeUnknown` gives an empty 504 response. The error handler (`onError` in `src/server/error.ts`) adds the body `{"message":"Gateway Timeout"}`. The result is an infrastructure fault ([ADR-0007](./0007-failures-have-three-classes.md)).

Put `withOutboundTimeout(operation)` around each outbound call in `apps/effect`. At this time, `apps/effect` has no outbound call. This example shows the use:

```ts
const charge = withOutboundTimeout("payments.charge")(payments.charge(order));
// Effect<Receipt, PaymentRefused | OutcomeUnknown>
```

### No retry after outcome unknown

Do not retry a non-idempotent operation after "outcome unknown", unless the operation has an idempotency key (see [Bounded retries and idempotency](#bounded-retries-and-idempotency)). A retry without a key can do the action two times, for example two charges for one order. Before a retry, examine the remote state, or send a key that lets the remote side find the first attempt.

A retry after a refusal is a different decision. It is not correct without a change to the request (ADR-0007).

This rule narrows the "Retry" column of ADR-0007. An infrastructure fault is safe to retry with the same request only if the operation is idempotent or has an idempotency key.

### One place for each timeout value

There are two timeout values:

- The **inbound timeout**: how long the server waits for its own handler. Then it answers 504.
- The **outbound timeout**: how long a handler waits for one outbound call. Then the call fails with "outcome unknown".

Each value has one place. Do not write a timeout value in a handler.

| App | Inbound timeout | Outbound timeout |
| --- | --- | --- |
| `apps/effect` | `INBOUND_TIMEOUT` in `src/server/timeout.ts` | `OUTBOUND_TIMEOUT` in `src/server/timeout.ts` |
| `apps/hono` | `INBOUND_TIMEOUT` in `src/app/app.ts`, for `hono/timeout` | None. `apps/hono` has no outbound client. |

The outbound timeout must be shorter than the inbound timeout. If it is not shorter, the server stops the request first, and the handler cannot see "outcome unknown" or tell the client. In `apps/effect`, a test in `src/server/timeout.test.ts` checks this order. When `apps/hono` gets an outbound client, add its outbound timeout as one constant, and add a test for the same order.

The tests for `withOutboundTimeout` and `OutcomeUnknown` are in `apps/effect/src/server/timeout.test.ts`.

## Bounded retries and idempotency

A retry sends the request again. During an incident, the dependency is already slow or down. Each retry adds load to it. If each layer of a call path retries, the attempts multiply: three layers with three attempts each send 27 requests for one user action. A retry of a write that is not idempotent can also do the action two times.

### Each retry has a bound

Each retry stops after a known number of attempts or a known duration. The lint rule `anti-slop-effect/bounded-retry` (`tools/lint/anti-slop-effect/rules/bounded-retry.ts`) enforces this rule:

- `Effect.retry`, `Effect.retryOrElse` and `Stream.retry` must have a bound that the rule can see. A bound is one of these:
  - In the options: `times`, `until` or `while`.
  - In the schedule: `Schedule.recurs`, `Schedule.once`, `Schedule.during`, `Schedule.duration`, or a `Schedule.upTo` step with `times` or `duration`.
- `Schedule.spaced`, `Schedule.exponential`, `Schedule.fibonacci`, `Schedule.fixed`, `Schedule.cron`, `Schedule.windowed` and `Schedule.forever` do not stop. Add a bound to them.
- `Schedule.max([...])` stops when one of its schedules stops, so it has a bound when one schedule has a bound. `Schedule.min([...])` stops only when all of its schedules stop, so it has a bound only when all schedules have a bound. `Schedule.concat` has a bound only when the two schedules have a bound.
- The rule follows a policy that is a `const` in the same file. It does not follow an import. If the policy comes from another module, add `times` at the call site: `Effect.retry(effect, { schedule: policy, times: 3 })`.
- `Schedule.forever` is an error in source files, also outside a retry. Test files can use it.
- In a file that imports `ky` (at this time, only `apps/hono`), a `ky` `retry` option object must set `limit`. The `ky` default is 2 retries, but a reader cannot see the default at the call site.

```ts
const backoff = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 })
);
const charge = payments.charge(order).pipe(Effect.retry(backoff));
```

### One retry owner for each call path

Only one layer of a call path retries. This layer is the **retry owner**. The other layers send each failure up without a retry.

- The retry owner is the layer nearest to the dependency that knows if the operation is idempotent. Usually this is the outbound client of the dependency.
- A handler does not retry a service call that already retries.
- When a library retries by default (for example `ky`), that library is the retry owner, or its `retry` is `0`.
- A retry that is not the owner is an error in code review.

### Retry of a write needs an idempotency key

A read is safe to retry. A write is safe to retry only when it is idempotent, or when it has an idempotency key ([No retry after outcome unknown](#no-retry-after-outcome-unknown)).

- `GET` and `HEAD` are safe to retry.
- A `POST`, `PUT` or `PATCH` route that a client can retry accepts an `Idempotency-Key` request header. HTTP says that `PUT` is idempotent, but a handler can break this property, for example when it adds a row or sends an event. The server records the key with the result of the first request. A second request with the same key gets the recorded result. The server does not do the action again.
- If a second request with the same key has a different body, the server answers 422.
- An outbound write that the retry owner retries sends an idempotency key to the dependency. If the dependency cannot accept a key, the retry owner does not retry the write.

At this time, no route in `apps/hono` or `apps/effect` accepts an `Idempotency-Key`, and neither app retries a write. Add the key before a client retries a write route.

The tests for `anti-slop-effect/bounded-retry` are in `tools/lint/anti-slop-effect/rules/bounded-retry.test.ts`.

## Concurrent work has an owner and a bound

Concurrent work without a bound starts one fiber or promise for each input. A large input can use all connections, all memory or all of a rate limit. Work without an owner is worse: no parent waits for it, so its failures are lost, and it continues after the request ends.

### Each concurrent step has a bound

- `concurrency: "unbounded"` is an error. Set a number from a named constant, for example `concurrency: READINESS_CONCURRENCY`. This applies to `Effect.forEach`, `Effect.all`, `Stream.mapEffect` and each other step that accepts a `concurrency` option.
- The rule examines only files that import an Effect module. It examines test files too.

### Each fiber has an owner

- In `src/`, `Effect.forkDetach`, `Effect.forkDaemon`, `Effect.runFork` and `Effect.runForkWith` are errors. Use `Effect.forkChild` or `Effect.forkScoped`, or `Effect.forkIn` with the scope of a Layer.
- The entry points in `src/app/` start the runtime, so they can use these calls. The `entryPoints` option of the rule sets the entry points. The default is `apps/*/src/app/**`.
- Test files are not examined. `effect-tests/no-manual-effect-runtime-in-tests` already forbids `Effect.runFork` in tests.

The lint rule `anti-slop-effect/bounded-owned-concurrency` (`tools/lint/anti-slop-effect/rules/bounded-owned-concurrency.ts`) enforces the two rules above. Its tests are in `tools/lint/anti-slop-effect/rules/bounded-owned-concurrency.test.ts`.

### Each promise has a handler

In `apps/hono`, each promise has `await`, `return` or `void`. The rule `typescript/no-floating-promises` enforces this. `oxlint.config.ts` sets it to `"error"`.

## Admission control, bulkheads and backpressure

A server without a limit accepts each request. Under a spike, all requests share the CPU, the memory and the connections, so all requests become slow. Clients wait, time out and retry, and this adds more load. The recovery is slow too, because the server must complete the old work before it can do new work. We decide that each app limits the number of requests in flight. A request that comes when the app is full gets a fast refusal. The requests that the app accepts keep their usual latency.

### Each app has a maximum of requests in flight

- Each request takes one slot when it arrives, and gives the slot back when its handler ends. This includes a failure, a throw and an interrupt.
- When no slot is free, the app does not put the request in a queue. It answers `503` immediately, with the header `Retry-After: 1` and the body `{"message":"Service Unavailable"}`. The handler does not run.
- `503` is an infrastructure fault ([ADR-0007](./0007-failures-have-three-classes.md)). The `Retry-After` header is the backpressure: it tells the client to wait before it sends the request again. The rules in [Bounded retries and idempotency](#bounded-retries-and-idempotency) also apply to this retry.
- The admission middleware runs before the work that costs much (authentication, the handler), and after the middleware that gives each response its request id, its security headers and its CORS headers.

### Probes have their own capacity

The health and probe routes have a bulkhead: their own slots, separate from the other requests. When the app is full, a probe still gets an answer. Thus the orchestrator does not stop an app that is busy but healthy.

### Where the limits are

Each limit has one place, and it comes from configuration. Do not write a limit in a handler. Each limit is an integer that is more than 0. The app does not start with a different value.

| App | Middleware | Request limit | Probe limit | Probe routes |
| --- | --- | --- | --- | --- |
| `apps/effect` | `admission` in `src/server/admission.ts`, in the `CHAIN` of `src/app/chain.ts` | `MAX_IN_FLIGHT_REQUESTS` (`Config`, default 256) | `MAX_IN_FLIGHT_PROBES` (`Config`, default 8) | The `PROBES` of `src/features/health/api.ts` |
| `apps/hono` | `admissionMiddleware` in `src/server/middleware/admission.ts`, in `src/app/app.ts` | `MAX_IN_FLIGHT_REQUESTS` (`ENV`, default 256) | `MAX_IN_FLIGHT_PROBES` (`ENV`, default 8) | `PROBE_PATHS` in `src/app/app.ts`. At this time it is empty, because `apps/hono` has no probe route. Add the path of each new probe route. |

`apps/effect` uses a `Semaphore` and `withPermitsIfAvailable(1)`, so a request never waits for a permit. When the inbound timeout stops a handler, the interrupt gives the permit back.

In `apps/hono`, the admission middleware is outside `hono/timeout`. When the inbound timeout answers 504, the slot comes back, but the handler can continue. Thus a slow handler can use more than its slot for a short time. Keep the handlers inside the inbound timeout.

### Proof

- The tests for the middleware are in `apps/effect/src/server/admission.test.ts` and `apps/hono/src/server/middleware/admission.test.ts`.
- The route tests are in `apps/effect/tests/middleware.test.ts` (the admission middleware) and `apps/hono/tests/admission.test.ts`. They fill the capacity through the full app, and they examine that the next request gets `503` with `Retry-After`.
- In `packages/load`, the `shed` counter counts each `503`, and the check `a 503 has Retry-After` must pass. The threshold `http_req_duration{status:200}` measures only the accepted requests. Run the `stress` and `spike` profiles with a low `MAX_IN_FLIGHT_REQUESTS` to see the shedding.

## Circuit breakers for slow dependencies

When a dependency is down or slow, each call waits until the outbound timeout. Each waiting call holds a request slot, a connection and memory, and it adds load to a dependency that is already in trouble. A timeout bounds one call. It does not stop the next call. We decide that each outbound dependency has a circuit breaker. The breaker keeps a state, and the state decides if the app sends the call at all. When the breaker is open, the call fails immediately and the app does not send it.

No lint rule can enforce this section, because a lint rule cannot see the state. Code review and the tests below enforce it.

### The states

| State | What the breaker does | It changes when |
| --- | --- | --- |
| **Closed** | It sends each call. It counts the consecutive faults. | The count gets to the threshold: it goes to **Open**. |
| **Open** | It sends no call. Each call fails immediately with `CircuitOpen`. | The cooldown ends: the next call goes through as the **probe**, and the state is **Half-open**. |
| **Half-open** | It sends one call, the probe. Each other call fails immediately with `CircuitOpen`. | The probe succeeds or is refused: **Closed**, with a count of 0. The probe is a fault: **Open** again, for one more cooldown. The probe is interrupted: **Open**, with the cooldown already ended, so the next call is the probe. |

- **A fault** is a failure that is not a refusal: `OutcomeUnknown`, a defect, an error with a status of 500 to 599, or an error without a status. **A refusal** (an error with a status of 400 to 499, [ADR-0007](./0007-failures-have-three-classes.md)) means that the dependency answered, so it is a success for the breaker and resets the count.
- **An interrupt** is not a result. The breaker does not count it. When the probe is interrupted, the breaker lets the next call be the probe.
- **A late result** is the result of a call that started before the breaker opened. While the breaker is **Open** or **Half-open**, the breaker ignores it: only the probe can move the breaker out of **Half-open**, and no call can move it out of **Open** before the cooldown ends. The breaker does not record when a call started. Thus, if a late call could finish after the breaker closed again, its result would change the new count. The cooldown rule in [The policy](#the-policy) prevents this, but only for a call in `withOutboundTimeout`.
- The count is of **consecutive** faults. It is not a rate in a time window. One success or one refusal sets it to 0.
- The state is local to the process. Each instance of the app has its own breakers and does not share their state.

### Which dependencies get a breaker

- Each outbound dependency gets one breaker: one database, one remote API. All calls to that dependency share the breaker.
- Put `breaker.protect` outside `withOutboundTimeout`, so that a timeout is a fault for the breaker. Put the retry ([Bounded retries and idempotency](#bounded-retries-and-idempotency)) outside the breaker, so that a retry does not go to an open breaker. A retry of `CircuitOpen` before `retryAfterSeconds` is an error in code review.

```ts
const payments = yield* makeBreaker("payments");
const charge = payments.protect(
  withOutboundTimeout("payments.charge")(client.charge(order))
);
// Effect<Receipt, PaymentRefused | OutcomeUnknown | CircuitOpen>
```

At this time, `apps/effect` has no outbound call, so it has no breaker. `apps/hono` has no outbound client. When `apps/hono` gets one, it follows the same states and policy.

### The policy

The policy has one place: `BREAKER_POLICY` in `apps/effect/src/server/breaker.ts`. Do not write a threshold or a cooldown in a handler.

| Value | Default | Rule |
| --- | --- | --- |
| Trip threshold (`threshold`) | 5 consecutive faults | More than 1, so that one fault does not open the breaker. |
| Cooldown (`cooldownMillis`) | 30 seconds | Longer than `OUTBOUND_TIMEOUT`, so that a probe does not start while a call of the last closed period can still wait. |
| Probes in Half-open | 1 | Only one call tests the dependency. |

A test in `src/server/breaker.test.ts` checks the two rules on the defaults.

### What the client gets

`CircuitOpen` gives an empty `503` response with the header `Retry-After`. Its value is the number of seconds until the cooldown ends (at least 1). The error handler adds the body `{"message":"Service Unavailable"}`. The result is an infrastructure fault ([ADR-0007](./0007-failures-have-three-classes.md)). `CircuitOpen` contains the `dependency` name.

### The breaker reports to the readiness probe

Each breaker has a readiness check, `breaker.readiness`, with the name `circuit:<dependency>`. The check fails only while the breaker is **Open**. In **Half-open**, the check passes, so that traffic can come back and send the probe. Give the check to `Health.make` for a dependency that each route needs. For a dependency that only some routes need, do not give the check to the readiness probe: an open breaker of that dependency must not remove the instance from the load balancer. The breaker writes a `warn` log line with the `dependency`, `from` and `to` annotations at each change of state.

### Proof

- The pure state-transition core (`admit`, `settle`, `statusAt`) is in `apps/effect/src/server/breaker.ts`. The property tests in `src/server/breaker.test.ts` generate histories of calls, results and waits ([ADR-0005](./0005-property-based-tests.md)). They check these rules: an open breaker rejects each call before the cooldown ends; not more than one probe is in flight; the closed count stays below the threshold; the breaker opens after exactly the threshold of consecutive faults; and after the cooldown, one successful probe closes it.
- The Effect wrapper (`makeBreaker`, `CircuitOpen`) has its tests in the same file. They use `TestClock` for the cooldown.
- The route test is in `apps/effect/tests/breaker.test.ts`. It trips the breaker through the full middleware chain. Then it examines that the next request gets `503` with `Retry-After`, that the dependency gets no call, and that the readiness probe reports `circuit:payments` as `fail`.

## Golden signals: saturation and failed work

A server that only measures requests and their duration does not show overload early. The latency goes up when the server is already full, and a fast `503` or `504` can make the average latency go down. We decide that both apps measure the four golden signals: latency, traffic, errors and saturation. The metrics show failed work by its kind, and they show how full the server is.

No lint rule can enforce this section. Code review and the tests below enforce it.

### The four signals and their metric names

| Signal | Metric | Type | Attributes |
| --- | --- | --- | --- |
| Latency | `http.server.request.duration` | Histogram, in seconds | `http.request.method`, `http.response.status_code` |
| Traffic | `http.server.request.duration` (the count of the histogram) | Histogram | The same |
| Errors | `http.server.failed_requests` | Counter | `http.request.method`, `error.type` |
| Saturation | `http.server.active_requests` | Up-down counter | `http.request.method` in `apps/hono` only |
| Saturation | `http.server.admission.rejections` | Counter | `bulkhead` |

- The names `http.server.request.duration` and `http.server.active_requests` are OpenTelemetry semantic conventions. The two other names are ours. `error.type` is the OpenTelemetry attribute for the class of an error.
- Do not add a different metric for the same signal. Add an attribute to the metric of the signal.

### Failed work has a kind

`http.server.failed_requests` counts each request that failed on the server: a response status of 500 or more. The attribute `error.type` gives the kind:

| Status | `error.type` | What it means |
| --- | --- | --- |
| 504 | `timeout` | The inbound timeout or `OutcomeUnknown`. The outcome is unknown ([Timeouts bound waiting](#timeouts-bound-waiting)). |
| 503 | `rejected` | The server did not do the work: admission was full, or a circuit breaker was open. |
| 502 | `upstream` | A dependency answered with an error. |
| Each other status of 500 or more | `defect` | A bug: an error that the code did not expect ([ADR-0007](./0007-failures-have-three-classes.md)). |

- A refusal (a status of 400 to 499) is not failed work. The client must correct the request. The histogram counts refusals by their status code.
- `failureKind` gives the kind from the status. It is in `apps/effect/src/server/metrics.ts` and in `apps/hono/src/shared/utils/failure-class.ts`. The two functions give the same result.

### Saturation

- `http.server.active_requests` is the number of requests in flight. It goes up when a request arrives and goes down when its response is ready. This includes a failure, a timeout and an interrupt.
- `http.server.admission.rejections` counts each request that the admission middleware rejected with `503` ([Admission control, bulkheads and backpressure](#admission-control-bulkheads-and-backpressure)). The attribute `bulkhead` is `requests` or `probes`. A rejection of a probe is a sign that the probes need more capacity.
- The apps have no queue, because admission does not put a request in a queue. Thus there is no queue depth metric. The rejections counter shows the work that a queue would hold.
- Compare `http.server.active_requests` with `MAX_IN_FLIGHT_REQUESTS`. When it stays near the limit, the app is saturated before it rejects requests.

### Where the metrics are

| App | Latency and traffic | Errors | Active requests | Admission rejections |
| --- | --- | --- | --- | --- |
| `apps/effect` | `requestDuration` in `src/server/metrics.ts` | `failedRequests` in `src/server/metrics.ts` | `activeRequests` in `src/server/metrics.ts` | `admissionRejections` in `src/server/metrics.ts`, updated by `withAdmission` in `src/server/admission.ts` |
| `apps/hono` | `httpInstrumentationMiddleware` of `@hono/otel` | `failedRequestsMiddleware` in `src/server/middleware/metrics.ts` | `httpInstrumentationMiddleware` of `@hono/otel` | `admissionMiddleware` in `src/server/middleware/admission.ts` |

- In `apps/effect`, the `metrics` middleware is the second entry of the `CHAIN` in `src/app/chain.ts`. It is outside `admission`, `timeout` and `onError`, so it sees the final status of each response, also a `503` from admission.
- In `apps/hono`, `failedRequestsMiddleware` is immediately after `httpInstrumentationMiddleware` in `src/app/app.ts`, for the same reason. Both apps get the meter from the OpenTelemetry SDK that `instrumentation.ts` or `observability.ts` starts.

### Proof

- `apps/effect/src/server/metrics.test.ts` and `apps/hono/src/server/middleware/metrics.test.ts` test the new metrics: each kind of failed work, no failed work for a refusal, and one series for each kind. The property tests check that a status below 500 is never failed work ([ADR-0005](./0005-property-based-tests.md)).
- `apps/effect/src/server/admission.test.ts` and `apps/hono/src/server/middleware/admission.test.ts` check that each rejection is counted under its bulkhead, and that an admitted request is not counted.
- The route tests in `apps/effect/tests/middleware.test.ts` (`the golden signals`) send requests through the full middleware chain. They check that a timeout and a defect are counted by their kind, that a refusal is not counted, and that the active requests go up during a request and go back to 0 after it ends, also after a timeout.

## Retention of data that accumulates

In a steady state, the work that the server does each day must not change. A store that only gets new rows or new files grows without a limit. Then its queries become slow, its indexes use more memory, and the disk becomes full. We decide that each store that accumulates data has a retention, and a job deletes the data that is older than the retention.

The guard test below makes this rule mechanical. No lint rule is necessary.

### The retention of each store

The `RETENTION` map in `apps/hono/src/server/retention.ts` has one entry for each table that `apps/hono/src/server/db/schema.ts` exports. The key is the SQL name of the table. An entry is `"keep"` or an expiry. An expiry has these fields: `table`, `key` (the primary key), `column` (the column that gives the age of a row), `clock` (`date` for a timestamp column, `epoch-ms` for a number of milliseconds) and `afterMs` (the time after which the job deletes the row).

| Store | Retention | Why |
| --- | --- | --- |
| `session` | Delete 1 day after `expires_at` | Better Auth does not accept an expired session. Better Auth deletes an expired session only when it reads that session. Thus a session that nobody uses again stays. The day lets an operator examine a recent sign-out. |
| `verification` | Delete 1 hour after `expires_at` | An expired verification value cannot verify anything. Each lookup of a verification value in Better Auth deletes all expired rows. When there are no lookups, the rows stay, so the job deletes them. |
| `rate_limit` | Delete 1 day after `last_request` | The longest Better Auth window is 60 seconds (the default window is 15 seconds, and some auth routes have a 10 or 60 second window). When the window is over, a row has the same effect as no row: Better Auth starts a new count. Thus a delete does not change a limit. Better Auth also deletes old rows when a window starts again. When there is no traffic, the rows stay, so the job deletes them. |
| `user` | `"keep"` | A user is business data. The delete of an account is a product decision, not a retention. |
| `account` | `"keep"` | An account belongs to a user. The foreign key deletes it with its user (`on delete cascade`). |
| `.evlog/logs` | Not used now | No app writes this directory at this time. Both apps send logs through OTLP, and the collector owns their retention. If an app adds the evlog file system drain (`createFsDrain`), set `maxFiles`. The drain writes one file each day and deletes the oldest file when there are more than `maxFiles`. |

`apps/effect` has no database and writes no files, so it has no entry.

When you add a table, add its entry to `RETENTION`. Use `"keep"` only when the table grows with the business, not with time or traffic.

### The cleanup job

`purgeExpired` in `apps/hono/src/server/retention.ts` deletes the expired rows of each table with an expiry, one table at a time.

- **The delete is idempotent.** The job deletes the rows that are older than the cutoff: `delete ... where key in (select key ... where column < cutoff limit n)`. When a row is already gone, the result is success. Two runs at the same time, or a run after a failed run, cannot do damage. Two runs at the same time can delete the same rows. Then one run can stop before it deletes all expired rows, and the next run deletes them. Thus the job is safe to retry, and a retry needs no idempotency key ([Bounded retries and idempotency](#bounded-retries-and-idempotency)).
- **Each run has a bound.** The job deletes in batches of 1000 rows, and not more than 100 batches for each table. When the last batch is full, the result for that table has `drained: false`, and the next run continues. The age columns have no index at this time, so each batch reads all of its table. When a table becomes large, add an index on its age column.
- **A failure stops the run.** The job does not retry. The scheduler runs it again at the next interval. The pool of the job has a connect timeout of 10 seconds and a Postgres `statement_timeout` of 30 seconds. These values are in `apps/hono/src/server/db/purge.ts`. They are for the job only, not for a handler.
- The job reports `{ table, deleted, drained }` for each table. A table that stays at `drained: false` for many runs grows faster than the job deletes. Then make the interval shorter.

Run the job with `bun hono db:purge` (`apps/hono/src/server/db/purge.ts`). It connects with `DATABASE_URL`, runs one time and exits. Run it from a scheduler outside the app (for example cron or a Kubernetes `CronJob`), one time each hour. The app does not run it, because then each instance of the app runs it.

### Proof

- The guard test in `apps/hono/src/server/retention.test.ts` (`RETENTION map`) reads each table that `schema.ts` exports. It fails when a table has no entry, when an entry has no table, or when an expiry uses a column of a different table.
- The tests of `purgeExpired` in the same file use a fake store at the `DeleteBatch` seam. They check the cutoff of each table and that a `"keep"` table does not change. They also check that a second run deletes nothing and succeeds, and that a run stops after its maximum of batches.
- The property tests in the same file check two rules ([ADR-0005](./0005-property-based-tests.md)). A run that drains keeps exactly the rows at or after the cutoff. One run never deletes more rows than its bound.
- `apps/hono/src/server/db/purge.ts` is the Postgres adapter of the seam. It is outside the coverage gate with the rest of `apps/hono/src/server/db/**`, because CI has no Postgres ([ADR-0001](./0001-unit-tests-are-pure-module-logic-and-api-routes-only.md)).

## References

- [Timeouts bound waiting](https://ratstack.sh/lore/timeouts-bound-waiting)
- [Retry needs idempotency](https://ratstack.sh/lore/retry-needs-idempotency)
- [Retry load needs a budget](https://ratstack.sh/lore/retry-load-needs-a-budget)
- [Concurrent work needs an owner](https://ratstack.sh/lore/concurrent-work-needs-an-owner)
- [Admission controls new work](https://ratstack.sh/lore/admission-controls-new-work)
- [Bulkheads isolate capacity](https://ratstack.sh/lore/bulkheads-isolate-capacity)
- [Backpressure reaches the producer](https://ratstack.sh/lore/backpressure-reaches-the-producer)
- [Every task needs an owner](https://ratstack.sh/lore/every-task-needs-an-owner)
- [Circuit breakers have state](https://ratstack.sh/lore/circuit-breakers-have-state)
- [Golden signals expose overload](https://ratstack.sh/lore/golden-signals-expose-overload)
- [Steady state recycles resources](https://ratstack.sh/lore/steady-state-recycles-resources)
- [Cleanup can be an idempotent postcondition](https://ratstack.sh/lore/cleanup-can-be-an-idempotent-postcondition)
- [ADR-0007: Failures have three classes](./0007-failures-have-three-classes.md)
