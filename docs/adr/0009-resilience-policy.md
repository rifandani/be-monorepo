---
status: accepted
---

# Resilience policy

A call to a dependency can fail slowly, fail partially or not answer. If each handler selects its own timeouts and retries, a retry can do one action two times, and a slow dependency can hold all of the server. We decide that both API apps follow one resilience policy. This ADR is the frame of that policy. Each section is one rule. A lint rule cannot express these rules, so code review and the tests in each section enforce them.

## Sections

| Section | Issue |
| --- | --- |
| [Timeouts bound waiting](#timeouts-bound-waiting) | #114 |
| Bounded retries and idempotency | #115 |
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

Do not retry a non-idempotent operation after "outcome unknown", unless the operation has an idempotency key (see #115). A retry without a key can do the action two times, for example two charges for one order. Before a retry, examine the remote state, or send a key that lets the remote side find the first attempt.

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

## References

- [Timeouts bound waiting](https://ratstack.sh/lore/timeouts-bound-waiting)
- [ADR-0007: Failures have three classes](./0007-failures-have-three-classes.md)
