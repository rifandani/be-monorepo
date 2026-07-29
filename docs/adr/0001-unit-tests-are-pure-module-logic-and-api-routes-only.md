---
status: accepted
---

# Unit tests are pure module logic and api routes only

Automated tests cover exactly two things: **pure module logic** (self-contained functions, called directly) and **api routes** (`apps/hono` endpoints, driven end-to-end through `app.request()`). The layer between them is deliberately untested, because the test doubles needed to reach it cost more than the resulting test tells us.

Coverage of that surface is enforced: `bun run test:cov` fails below **90%** on lines, functions, branches, and statements.

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
| `apps/hono/src/routes/middlewares/rate-limit/**` | **Conditional** — see below |

Every exclusion above is justified by test cost except rate-limit, which is justified by missing infrastructure: it is unwired, and its `DbStore` reaches a Postgres that CI has no service container for, so its branches would run on a developer machine but not in CI. It is therefore the only exclusion that expires — **when `rateLimit` is mounted in `app.ts`, remove it**, which forces the CI-database decision at that point rather than never.

Branches that are unreachable by construction — `getRuntimeKey()` returning a non-node runtime, an optional chain the middleware chain always satisfies — are left uncovered rather than papered over with `/* v8 ignore */`. The global (not per-file) threshold absorbs them.

## Consequences

- The excluded layers have no tests, and that absence is intentional — not an oversight to be "fixed."
- A wrong schema in `packages/core/src/apis/` will be found by reading the provider's types, not by a failing test. Re-deriving those schemas from the provider's own exports remains the preferred long-term fix.
- Coverage is a root-only vitest option under `projects`, so the gate exists only from the repo root; `bun hono test` runs without it. CI runs unsharded for the same reason — each shard would otherwise be gated against its own partial numbers. If the suite outgrows that, the fix is blob reports plus `vitest --merge-reports --coverage`.
- Reports go to `coverage/vitest`, deliberately not `coverage`, which is reserved for fallow's runtime sidecar. Pointing fallow at test coverage would make it report every excluded layer as dead code — the exact pressure this ADR exists to resist.
