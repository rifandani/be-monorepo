---
status: accepted
---

# Unit tests are pure module logic, api repositories, and api routes

Automated tests cover three things: **pure module logic** (self-contained functions, called directly), **api repositories** (`packages/core/src/apis/**`, HTTP clients that build requests and parse responses), and **api routes** (`apps/hono/tests/*.test.ts`, driven end-to-end through `app.request()` against the real app). Thin wrappers between them — HTTP client factories, declarative schemas-as-data, type-only modules — stay untested when mocking at the module boundary would prove nothing.

Coverage of that surface is enforced: `bun run test:cov` fails below **90%** on lines, functions, branches, and statements, **per file** (`thresholds.perFile`). A well-covered module cannot carry an untested one, so a file that lands inside the denominator has to be tested on its own merits.

## Vocabulary

> **Network Boundary** — where a request leaves the process (`fetch`/`http`/`XHR`). MSW fakes here, so everything the module does to build and parse the request really executes.
>
> **Module Boundary** — where an import is replaced (`vi.mock`). Faking here skips everything the replaced module would have done.

**Rule of thumb: if the subject under test builds or parses an HTTP request, fake at the Network Boundary; otherwise fake at the Module Boundary.** Both idioms are legitimate; mixing them in one file is a smell.

## Considered options

We considered testing api repositories with module-boundary mocks (`vi.mock("ky")`, hand-rolled `{ instance: { post } }` objects) and rejected them: real ky never runs, so a wrong prefix, dropped header, or bad path template cannot fail a test. They now fake at the network boundary with `msw@2` (`setupServer`, Node only), which runs real ky, real URL construction, and real Zod parsing. This does **not** widen the scope to browser mode — unit tests remain under `environment: "node"`, no jsdom, no `msw/browser`.

We considered fixtures derived from the Zod schemas and rejected them as actively harmful: these modules exist to run `schema.parse(response)`, so a fixture generated from that schema can never fail it. Each repository test file includes a *schema-violating 200* case alongside HTTP error cases.

We considered `expect()` inside an MSW resolver and rejected it as an anti-pattern. A throwing resolver becomes a failed response, so ky raises an `HTTPError` and the report shows a confusing 500 instead of the assertion. **Use capture-then-assert**: stash the request/body in the resolver, assert in the test body after the `await`.

We considered a shared handler catalog, or handlers inside `packages/core/src/mocks/`, and rejected them; test-only code does not belong in the package every app imports from. Root-level `vitest.msw.ts` sits beside `vitest.msw-setup.ts`, which owns the lifecycle.

We considered re-exporting `http`/`HttpResponse` through `vitest.msw.ts` and rejected it; test files import `msw` directly (root-hoisted devDependency — neither `msw` nor `vitest` is declared in `packages/core/package.json`).

We considered scoping pure-logic tests to `packages/*`, on the grounds that apps are covered end-to-end. Rejected: `apps/hono/src/core/utils/` holds ~500 lines of self-contained functions whose branches `app.request()` cannot reach. They are pure module logic wherever they happen to live.

Other layers we still reject:

- **Thin client wrappers** (`packages/core/src/services/http.ts`) have no branching of their own; a test would restate the ky API.
- **Zod schemas in isolation** — a `.parse()` test asserts that zod works. What actually breaks is drift from the upstream service, which only a review against the provider's published types can catch.

## How tests are written

- **Pure module logic** — colocated `src/**/*.test.ts`, in packages and apps alike, called with real inputs (a real `Headers`, a real `new Hono()` context, a real `File`). No `vi.mock`. `vi.spyOn(console, …)` is fine: console is the output under assertion, not a faked collaborator.
- **Api repositories** — colocated `packages/core/src/apis/*.test.ts`, MSW at the Network Boundary. Every test declares its handlers via `server.use()`; `onUnhandledRequest: "error"` hard-fails anything undeclared. `authRepositories(http)` takes `Http` by parameter, so tests own the base URL via `new Http({ prefix: MOCK_API_BASE_URL })`.
- **Api routes** — `apps/hono/tests/*.test.ts` against the real `app`, no mocking. To reach app-level behaviour such as `onError`, register a test-only route under `/__test/` using `get` rather than `openapi`, which keeps it out of the OpenAPI document.

## MSW lifecycle

`server.listen()` lives in `vitest.msw-setup.ts`, added to `setupFiles` for the **`core` project only**. `apps/hono` deliberately omits it so route tests keep hitting the real app stack. A single `setupServer` instance is shared process-wide, which matters because the root config runs `pool: "threads"` with `isolate: false`: files in a worker share globals, and two interceptor instances would contend for the same patched `fetch`/`http`/`XHR`.

`onUnhandledRequest: "error"` (not `"warn"`) — an undeclared request hard-fails with `[MSW] Error: intercepted a request without a matching request handler`. Nothing in the core suite trips it outside the api-repository tests, because every handler is declared per test via `server.use()`.

`MOCK_API_BASE_URL` (`https://api.test`) is defined once in `vitest.msw.ts`. Handler paths must be absolute because `setupServer` runs in Node with no `document.baseURI`.

`@test/msw` is aliased in `packages/core/vitest.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`) for imports of `server` and `MOCK_API_BASE_URL`.

## The coverage denominator

`coverage.include` is every source file under `apps/hono/src` and `packages/core/src`. The gate is fail-closed: a new module counts the moment it lands, so it must be tested or earn an exclusion here.

| Excluded | Reason |
| --- | --- |
| `packages/core/src/{services,constants,types}/**` | Thin clients, declarative data, type-only modules |
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

- Api repositories in `packages/core/src/apis/` are tested at the Network Boundary; a wrong schema or URL now fails a test rather than relying on manual review alone.
- The still-excluded layers have no tests, and that absence is intentional — not an oversight to be "fixed."
- A new file inside the denominator now has to clear 90% by itself. Adding one untested helper fails the gate immediately instead of being averaged away, which is the point; the two escape hatches are a test or a justified row in the table above.
- Coverage is a root-only vitest option under `projects`, so the gate exists only from the repo root; `bun hono test` runs without it. CI runs unsharded for the same reason — each shard would otherwise be gated against its own partial numbers. If the suite outgrows that, the fix is blob reports plus `vitest --merge-reports --coverage`.
- Reports go to `coverage/vitest`, deliberately not `coverage`, which is reserved for fallow's runtime sidecar. Pointing fallow at test coverage would make it report every excluded layer as dead code — the exact pressure this ADR exists to resist.
- **fallow:** `vitest.msw-setup.ts` needs `unused-files: "off"` in `.fallowrc.json`, since `setupFiles` loads it by path and no import edge reaches it. `fallow dead-code` may report `msw` under "dev dependencies used in production" because it counts `*.test.ts` under `src/` as production; every `msw` import site is a test file or `vitest.msw.ts`, and it must stay a root devDependency.

## Amendments

- [ADR-0002](./0002-mutation-testing-is-advisory.md) derives the advisory mutation-testing scope from this ADR's coverage denominator (`include` minus `exclude`), so the two conditional exclusions above enter that scope on the commit that removes them.
