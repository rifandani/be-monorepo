---
status: accepted
---

# Tests state their own environment

The Effect tests run without an env file and without shared ambient state. Each test states the configuration and the registries that it reads. This app has three test idioms, and each one answers a different question. This ADR adds to the root [ADR-0001](../../../../docs/adr/0001-unit-tests-are-pure-module-logic-and-api-routes-only.md).

## No env file

`vitest.config.ts` has no `dotenvx` block, unlike `apps/hono`. Hono validates its environment at module load, so the values must exist before the first import. Here a `Config` resolves when its layer builds, so a test that needs `APP_URL` gives a `ConfigProvider` of its own. Each suite that reads `APP_URL` states it again, so the policy under test stays in the file that asserts against it.

## Fresh registries

`Metric.MetricRegistry` is a `Context.Reference`, and a reference caches what `defaultValue` returns. The default registry is one `Map` for the whole process, so a count against it depends on which files ran first. Each suite calls `defaultValue()` to get its own registry.

## Three idioms

- **`HttpApiTest.groups`** (`tests/health.test.ts`) builds a typed client wired to the handlers, with the real encoding, routing and decoding, and no port. It rebuilds the routes from the API description, so it cannot see a mount point move. The handlers are taken without their dependencies: the real `Health` can never fail a check, so the 503 half of readiness needs a swapped service.
- **`toWebHandler` over the composed `app`** (`tests/app.test.ts`, `tests/middleware.test.ts`, `tests/nesting.test.ts`) is the only idiom that fails when a mount point or the OpenAPI path regresses. `tests/app.test.ts` asserts the mount points by iterating `PROBES`. `tests/middleware.test.ts` asks whether each chain entry runs at all, because coverage cannot: `metrics`, `timeout` and `quietProbes` were at 100% per-file coverage while nothing asserted them. It uses three collectors:
  - `Layer.provideMerge`, not `Layer.provide`. `toWebHandler` uses the output context of the built layer as the base of every request fiber, so a reference reaches a request only if it is merged out.
  - The framework log line stays on, and a collecting `Logger` replaces the default, so an absent line is an assertion.
  - The tracer needs no wiring. `HttpEffect.toHandled` already applies it; passing it again opens two spans.
- **`NodeHttpServer.layerTest` over a real socket** (`tests/platform.test.ts`). Web requests carry an absolute `originalUrl`, and Node carries a bare path ([ADR-0004](./0004-global-middleware-reads-request-url.md)). Each case is one request field read by one middleware, plus the 404 that leaves by the failure path. Mount points and header composition stay in `tests/app.test.ts`, because they do not change with the transport. One socket serves the whole file, because the app keeps no state between requests. The test is Node only: `BunHttpServer.make` calls `Bun.serve`, which cannot run under the Node-hosted vitest, and Bun backs its request with a web `Request`, which `tests/app.test.ts` already drives. Add a Bun lane when the two differ.

## Seams under test

- **`timeout.test.ts` drives `withTimeout` with its own duration** under the `TestClock` of `it.effect`, so the tests take no time. Asserting the private 15 second constant against itself proves nothing.
- **`service.test.ts` drives `Health.make` with its own checks**, because this app has no dependency that can fail.
