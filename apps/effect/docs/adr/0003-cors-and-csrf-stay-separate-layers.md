---
status: accepted
---

# CORS and CSRF stay separate layers

`apps/effect/src/server/cors.ts` and `apps/effect/src/server/csrf.ts` stay two modules and two separately-registered layers. They share the Allowed Origin, which lives in `origin.ts`, and nothing else.

This is written down because the suggestion to merge them is a reasonable-looking one that arrives on its own. Both modules read `APP_URL`, both wrap it in `Layer.unwrap`, both are about which origin the app trusts, and both are small — `cors.ts` is 16 lines of code. An architecture review proposed exactly that merge, as "one Origin Policy module" exporting both layers, and the shared premise was extracted instead.

## Why they stay apart

**They are six apart in the chain.** `http.ts` nests ten global middlewares with `Layer.flatMap`, and registration order is nesting order. `cors` is sixth and `csrf` is ninth; between them sit `timing`, `timeout` and `language`. So what a response carries depends on where each one is: a cors preflight is answered before `timing` ever runs and leaves without a `Server-Timing` header, while a csrf 403 is produced inside all nine and carries everything, including the language cookie. One layer cannot hold two positions. A merged module would either export two layers anyway — which is what it already has — or collapse the spacing and change four responses.

**Tests assert that spacing.** `apps/effect/tests/nesting.test.ts` is a table over the four responses that never reach the router, one column per header a middleware sets on its own way out. The cors preflight row and the csrf 403 row differ precisely because the two middlewares sit at opposite ends of the chain. Merging them fails those rows; that is the point of the table.

**The deletion test says nothing concentrates.** Put the two implementations in one file and there is a cors options block and a four-condition predicate side by side, still sharing exactly one string. No caller is simplified, no knowledge moves to one place, and the file now has two exports the chain must keep apart. What did concentrate is the premise: `url.origin` and not `url.toString()` was a rule stated in `cors.ts` and silently repeated in `csrf.ts`, and that is now one statement in `origin.ts` with a test.

**They answer different questions.** CORS tells a browser who may *read* a response. CSRF decides whose state-changing request is *honoured* — a header check, not a token, and `OPTIONS` counts as safe in it so a preflight is never rejected. The two happen to consult the same origin. Sharing a premise is not sharing a policy.

## Consequences

- `origin.ts` owns the Allowed Origin. A change to how the trusted origin is derived is one edit, and `origin.test.ts` asserts the rule.
- Each policy keeps its own `Layer.unwrap`. Three lines of idiom in each is the cost of two layers, and two layers is a requirement of the chain rather than an accident.
- A future architecture review that proposes merging them should read `tests/nesting.test.ts` first. If the table can be satisfied by a single layer, this decision is worth reopening; today it cannot.
