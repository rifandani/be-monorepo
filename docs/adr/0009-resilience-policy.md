---
status: accepted
---

# Resilience policy

A call to a dependency can fail slowly, fail partially or not answer. If each handler selects its own timeouts and retries, a retry can do one action two times, and a slow dependency can hold all of the server. We decide that both API apps follow one resilience policy. This ADR is the frame of that policy. Each section is one rule. Where a lint rule can express a rule, the section names the lint rule. Code review and the tests in each section enforce the other rules.

## Sections

| Section | Issue |
| --- | --- |
| [Timeouts bound waiting](#timeouts-bound-waiting) | #114 |
| [Bounded retries and idempotency](#bounded-retries-and-idempotency) | #115 |
| [Concurrent work has an owner and a bound](#concurrent-work-has-an-owner-and-a-bound) | #116 |
| Admission control, bulkheads and backpressure | #117 |
| Circuit breakers for slow dependencies | #118 |
| Golden signals: saturation and failed work | #119 |
| Retention of data that accumulates | #121 |

A section without a link is not in this ADR yet. Its issue adds it.

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

## References

- [Timeouts bound waiting](https://ratstack.sh/lore/timeouts-bound-waiting)
- [Retry needs idempotency](https://ratstack.sh/lore/retry-needs-idempotency)
- [Retry load needs a budget](https://ratstack.sh/lore/retry-load-needs-a-budget)
- [Concurrent work needs an owner](https://ratstack.sh/lore/concurrent-work-needs-an-owner)
- [Every task needs an owner](https://ratstack.sh/lore/every-task-needs-an-owner)
- [ADR-0007: Failures have three classes](./0007-failures-have-three-classes.md)
