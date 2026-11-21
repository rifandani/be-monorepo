---
status: accepted
---

# The Middleware Chain is one ordered tuple

`CHAIN` in `src/app/chain.ts` is the only statement of the Middleware Chain order, outermost first. It was a `Layer.flatMap` staircase with the order written again in prose, and the prose drifted: it said ten entries where there are eleven, and ADR-0003 copied the count. A tuple has a length that nothing must maintain. `tests/middleware.test.ts` asserts that every entry registers. `tests/nesting.test.ts` asserts what each order produces, with its own table ([ADR-0005](./0005-the-nesting-table-is-not-generated-from-the-chain.md)).

These records came from code comments. [ADR-0006 in the root](../../../../docs/adr/0006-code-has-no-comments.md) moved them here.

## How the chain is built

- **`Layer.flatMap`, not `Layer.mergeAll`.** A global middleware registers when its layer builds, and the registration order is the nesting order. `mergeAll` builds its members concurrently, so the nesting would follow whichever layer won the race.
- **A left fold.** `pipe` with two `Layer.flatMap` calls is `flatMap(flatMap(a, …), …)`, and `Layer.flatMap` builds `self` to completion, then the next layer, on the same scope and `MemoMap` (`Layer.ts:1662-1679` in the vendored source). The fold keeps the build, registration and finalizer order of the staircase.
- **`reduce` has an explicit type argument.** `Array.reduce` fixes the accumulator type from the seed. The seed, `requestId`, has no `ConfigError`, so an inferred fold rejects `cors`.
- **The error channel is `ConfigError`.** `cors` and `csrf` are `Layer.unwrap`ped over the Allowed Origin, which is a `Config`. `Layer.flatMap` unions error channels, so the chain carries it.
- **`Overrides` is the seam.** It replaces one entry by the name under which it is declared, so a typo does not compile. It has two adapters: the 15 second timeout, and the short one that `tests/nesting.test.ts` builds with `timeoutFor`. No route answers in more than 15 seconds, so only the short adapter can show that `timing` is outside `timeout`. It replaced a single layer parameter on `appWith`, because one parameter cannot serve eleven entries.
- **Each new API group needs its handler layer in `src/app/http.ts`.** A missing one is a runtime defect, not a type error.

## The order

Seven entries are the seven `apps/hono` mounts, in that order, except `secureHeaders`. `metrics` and `quietProbes` have no counterpart in `apps/hono`.

1. **`requestId`** — outermost, so every response carries an id, the csrf 403 and the cors preflight included. A report about one of them joins to its log line. It also annotates the logs of every other middleware.
2. **`metrics`** — it records the status of the response that leaves, so it is outside `onError` and `notFound`. Outside `cors` and `csrf`, the preflight and the 403 count as served traffic. It does not read or write a response.
3. **`quietProbes`** — outside for the same reason as `metrics`. It suppresses events and does not touch the response.
4. **`secureHeaders`** — the one entry out of the `apps/hono` order. That app mounts it after csrf, so its 403 leaves without the headers. Here it is outside every middleware that answers on its own, so the csrf 403, the timeout 504 and the cors preflight carry `nosniff` and the rest.
5. **`cors`** — it answers the preflight itself, so nothing from `timing` inwards runs for a preflight.
6. **`timing`** — outside `timeout`, because a request that was given up on is worth a `Server-Timing` header.
7. **`timeout`** — inside `timing`, so its 504 reports how long the request had.
8. **`language`** — inside `timeout`, so a 504 cannot carry the language cookie. Outside `csrf`, so a rejected request is answered in its language.
9. **`csrf`** — the innermost middleware that answers on its own. A 403 carries everything the eight outer entries add.
10. **`onError`** and 11. **`notFound`** — innermost. Every outer middleware sets headers with `Effect.map`, which runs only on success. A failure that travels past them leaves without a request id, a `Server-Timing` header or the security headers. Turning the failure into a response here makes a 404 and a 500 carry the headers of a 200. `notFound` is inside `onError`, so the miss that it claims never reaches the catch-all.
