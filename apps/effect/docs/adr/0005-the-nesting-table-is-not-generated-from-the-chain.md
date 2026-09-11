---
status: accepted
---

# The nesting table is not generated from the chain

`apps/effect/tests/nesting.test.ts` asserts what a short-circuited response carries with a hand-written table: one row per middleware that answers without reaching the router, one column per header the chain owns. That table stays hand-written. It is not derived from `CHAIN` in `apps/effect/src/server/chain.ts`, and no test iterates `CHAIN` to assert the order.

This is written down because the suggestion to generate it is the obvious next step after the chain became data, and it destroys the suite while looking like an improvement.

## Why the table stays hand-written

**Two accounts are the whole mechanism.** `CHAIN` declares the order; the table describes what that order produces. They are written independently, so a reorder moves one and not the other, and the disagreement is the failure. Generate the table from `CHAIN` and both move together: every reorder keeps the suite green, because the test now reads the same fact the implementation reads. The assertion becomes a tautology that costs the same to run.

**The table is not a restatement of the order.** It says what a cors preflight carries, not that `cors` is fifth. Those are different claims: the second is derivable from `CHAIN`, the first is a consequence of it that only a request can establish. Deriving the first from the second would mean re-deriving the nesting semantics in the test, which is the implementation.

## What `CHAIN` is asserted for instead

`tests/middleware.test.ts` asserts that the folded chain registers exactly `CHAIN.length` global middleware, by substituting the `HttpRouter` service with a spread of the real one whose `addGlobalMiddleware` counts.

That one is not a tautology, and the difference is worth being precise about. `CHAIN.length` is the declaration; the count is observed behaviour at layer build. A fold that drops an entry — a `slice`, a filter, a second copy of a layer already in the chain, which `Layer` memoizes into one registration — makes the two disagree. Order is not asserted there either.

## Why this came up

The chain was a `Layer.flatMap` staircase with the order restated in prose above it, and the prose drifted. It claimed ten entries where there are eleven; `docs/adr/0003` inherited the same count and also placed `cors` sixth where the test already said fifth. Nothing could catch either, because a count in a comment has nothing to disagree with.

That is the argument for `CHAIN`, and it is also the trap: having made the order data, the reflex is to make everything read from it. The count assertion is the part that should; the table is the part that must not.

## Consequences

- A reorder of `CHAIN` requires a matching edit to the table in `tests/nesting.test.ts`. That is the cost, and it is the point — an edit to one and not the other is the thing being detected.
- The presence assertion depends on `HttpRouter.make` being exported and the `HttpRouter` service being spreadable. This app is on `effect@4.0.0-rc.112`; if an rc bump moves either, the test fails to compile rather than silently passing. Re-derive it against the vendored source rather than deleting it.
- A future review that proposes generating the table should add a row to it instead. If the table cannot express the property being argued for, this decision is worth reopening.
