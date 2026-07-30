---
status: accepted
---

# Unit tests are pure module logic and api routes only

Automated tests cover exactly two things: **pure module logic** (self-contained functions, called directly) and **api routes** (`apps/hono` endpoints, driven end-to-end through `app.request()`). The layer between them is deliberately untested, because the test doubles needed to reach it cost more than the resulting test tells us.

Coverage of that surface is enforced: `bun run test:cov` fails below **90%** on lines, functions, branches, and statements, **per file** (`thresholds.perFile`). A well-covered module cannot carry an untested one, so a file that lands inside the denominator has to be tested on its own merits.

## Considered options

We considered testing the middle layer — schema definitions, HTTP client wrappers, repository functions — and rejected it:

- **Delegating repository functions** (`packages/core/src/apis/auth.ts`) are five lines of `http.instance.get(…) → .json() → schema.parse(…)`. Testing them means mocking the HTTP layer, after which the assertions confirm the mock was called with the URL the test itself supplied. The fallible part is the schema, not the delegation.
- **Thin client wrappers** (`packages/core/src/services/http.ts`) have no branching of their own; a test would restate the ky API.
- **Zod schemas** are declarative contracts. A `.parse()` test asserts that zod works. What actually breaks is drift from the upstream service, which only a review against the provider's published types can catch.

We also considered scoping pure-logic tests to `packages/*`, on the grounds that apps are covered end-to-end. Rejected: `apps/hono/src/core/utils/` holds ~500 lines of self-contained functions whose branches `app.request()` cannot reach. They are pure module logic wherever they happen to live.

## How tests are written

- **Pure module logic** — colocated `src/**/*.test.ts`, in packages and apps alike, called with real inputs (a real `Headers`, a real `new Hono()` context, a real `File`). No `vi.mock`. `vi.spyOn(console, …)` is fine: console is the output under assertion, not a faked collaborator.
- **Api routes** — `apps/hono/tests/*.test.ts` against the real `app`, no mocking. To reach app-level behaviour such as `onError`, register a test-only route under `/__test/` using `get` rather than `openapi`, which keeps it out of the OpenAPI document.

## The coverage denominator

`coverage.include` is every source file under `apps/hono/src` and `packages/core/src`. The gate is fail-closed: a new module counts the moment it lands, so it must be tested or earn an exclusion here.

| Excluded | Reason |
| --- | --- |
| `packages/core/src/{apis,services,constants,types}/**` | Delegating wrappers, thin clients, declarative data, type-only modules |
| `apps/hono/src/core/{constants,types}/**` | The same in the app: prompt-string data, the env schema, types |
| `apps/hono/src/db/**` | Thin pool wrapper plus a declarative drizzle schema |
| `apps/hono/src/auth/utils/**` | better-auth configuration |
| `apps/hono/src/core/utils/evlog.ts` | evlog drain configuration |
| `apps/hono/src/{bun,node,instrumentation}.ts` | Process bootstrap; importing them starts a server or an OTel SDK |
| `apps/hono/src/routes/middlewares/auth.ts` | **Conditional** — see below |
| `apps/hono/src/routes/middlewares/rate-limit/**` | **Conditional** — see below |

Every exclusion above is justified by test cost except the last two, which are justified by missing infrastructure — a Postgres that CI has no service container for:

- **rate-limit** is unwired, and its `DbStore` reaches the database directly, so its branches would run on a developer machine but not in CI. **When `rateLimit` is mounted in `app.ts`, remove it**, which forces the CI-database decision at that point rather than never.
- **`middlewares/auth.ts`** is four lines that hand `auth.api.getSession` to the context. Without a cookie, better-auth returns `null` before it queries anything, so route tests only ever take the anonymous side of `session ? … : null`; the authenticated side needs a real session row. **When CI gains a database, remove it** and cover both sides with a signed-in request.

Both expire, so the exclusion list stays a record of what infrastructure is missing rather than of what is hard.

Branches that are unreachable by construction are not papered over with `/* v8 ignore */` — with a per-file threshold there is no global slack to absorb them either, so the code is written not to have them. `xForwardedFor.split(",")[0]?.trim() ?? null` becomes a `replace`, and `codePointAt(i) ?? 0` over an `atob` string becomes `charCodeAt(i)`: in both cases the fallback existed only to satisfy `noUncheckedIndexedAccess`, and removing the optional access removes the branch. What remains uncovered is genuinely runtime-dependent — `getRuntimeKey()` returning `bun` under a node test run — and stays comfortably inside the 90% each file has to clear.

One v8 quirk is worth knowing before chasing a phantom gap: a ternary between two `await import()` expressions makes v8 lose coverage for every statement after it in the same function, reported as untested lines that demonstrably ran. `net.ts` keeps the conditional import in its own `importGetConnInfo` function for exactly this reason.

## Consequences

- The excluded layers have no tests, and that absence is intentional — not an oversight to be "fixed."
- A new file inside the denominator now has to clear 90% by itself. Adding one untested helper fails the gate immediately instead of being averaged away, which is the point; the two escape hatches are a test or a justified row in the table above.
- A wrong schema in `packages/core/src/apis/` will be found by reading the provider's types, not by a failing test. Re-deriving those schemas from the provider's own exports remains the preferred long-term fix.
- Coverage is a root-only vitest option under `projects`, so the gate exists only from the repo root; `bun hono test` runs without it. CI runs unsharded for the same reason — each shard would otherwise be gated against its own partial numbers. If the suite outgrows that, the fix is blob reports plus `vitest --merge-reports --coverage`.
- Reports go to `coverage/vitest`, deliberately not `coverage`, which is reserved for fallow's runtime sidecar. Pointing fallow at test coverage would make it report every excluded layer as dead code — the exact pressure this ADR exists to resist.
