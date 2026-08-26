# HTTP API

The app is built from one `HttpApi` description. That description supplies the
routes, the OpenAPI document, the Scalar page and a typed client. The routes,
the document and the client therefore always agree.

This document holds only the facts that cross more than one file. Each module
states its own reasons in its doc comment. Read the module before you change it.

## Layout

```
src/
  domain/         the shared vocabulary: schemas and typed errors
    greeting.ts   the `Greeting` schema, used by the description and the service
  api/            the description: which endpoints exist, and their schemas
    api.ts        HttpApi.make(...), with the OpenAPI annotations
    greetings.ts  the "greetings" group and its endpoints
  server/         the implementation
    greetings.ts  the `Greetings` service: what the app does
    greetings/
      http.ts     HttpApiBuilder.group(Api, "greetings", ...): the handlers
    http.ts       every group, plus the docs route, as one servable layer
    *.ts          one global middleware per file (see below)
    *.test.ts     unit tests for the pure parts of those modules
  config.ts       the environment
  metadata.ts     the OpenAPI title and version, from `package.json`
  node.ts         platform layer + runMain
  bun.ts          platform layer + runMain
tests/            endpoint tests, through the in-memory client and `app`
```

Each folder answers one question. A folder can import only from the folders
above it in this list:

- `domain/` — the values. It imports neither of the others.
- `api/` — how the values are reached. It imports `domain/`.
- `server/` — what happens. It imports both.

`api/` must not import from `server/`. A client needs the description only. A
client that also loaded handler code would load the database and the secrets
with it. `Greeting` is in `domain/` for the same reason: the service constructs
it, and the service is server code.

`api/` also contains no `Config`. Annotations are values that the module reads
when it loads, so a title from the environment would make the description an
`Effect`. See the comment in `src/api/api.ts`.

`vitest.config.ts` sets the test split: `src/**` for pure modules, `tests/**`
for endpoints. Imports in this app are relative. `apps/hono` uses the `@/`
alias, but `tsc` does not rewrite an alias when it emits, which makes its
`node:build` output unusable.

## To add an endpoint

1. Put any new schema in `src/domain/`.

2. Declare the endpoint in the group in `src/api/greetings.ts`. For a new group,
   declare the group and register it in `src/api/api.ts`:

   ```ts
   HttpApiEndpoint.get("hello", "/", { success: Greeting });
   ```

   Add a `payload`, `path` or `urlParams` schema if the endpoint takes input.
   Add an `error` schema for each failure that the caller must tell apart.

3. Add the operation to the service in `src/server/greetings.ts`, then call it
   from the handler in `src/server/greetings/http.ts`. Put the logic in the
   service, not in the handler. The database calls and the test double go there
   too.

4. Test it in `tests/`. `HttpApiTest.groups` supplies a typed in-memory client.
   It uses no server and no port:

   ```ts
   const client = yield* HttpApiTest.groups(Api, ["greetings"]);
   const greeting = yield* client.greetings.hello();
   ```

A new group also needs a `Layer.provide` in `src/server/http.ts`. If you forget
it, the app fails at runtime with `HttpApiGroup "..." not found`. The compiler
does not catch it. `tests/app.test.ts` drives the composed layer for this
reason.

Each handler module exports its layer twice: `greetingsHandlersNoDeps`, with the
service still open, and `greetingsHandlers`, with `Greetings.layer` provided.
The server mounts the second. `tests/greetings.test.ts` uses the first, which is
where a stub goes.

## Routes

`src/server/http.ts` sets `openapiPath: "/openapi"` and mounts Scalar at
`/openapi/docs`. Effect sends no OpenAPI route by default, and it mounts the UI
at `/docs`. These paths match `apps/hono` instead, so both apps answer at the
same URLs. `apps/effect/README.md` publishes them. `tests/app.test.ts` asserts
the mount points.

## Inside a handler

The per-request values are `Context.Reference`s, so a handler reads them
directly:

```ts
const id = yield* RequestId; // src/server/request-id.ts
const lang = yield* Language; // src/server/language.ts

// timers and marks for the `Server-Timing` header — src/server/timing.ts
const rows = yield* findMany.pipe(timed({ name: "query" }));
yield* setMetric({ description: "europe-west3", name: "region" });
```

`src/server/timing.ts` also exports `startTime` and `endTime` for work that is
not one effect. Every helper has an `@example` in that file.

## Conventions

These three rules hold across the middleware. A module that departs from one
says so in its doc comment.

- **A rejection is a response, not a failure.** The csrf 403 and the timeout 504
  are returned as responses. A failure would add an error type to `app` and to
  both entrypoints. The client gets the same status either way.
- **Per-request state is a `Context.Reference`, not a `Context.Service`.** The
  default value makes it readable without a requirement on every caller and
  every test. `RequestId`, `Language` and `Metrics` all use one.
- **Response headers are set with `Effect.map`, which runs only on success.**
  Every response this app makes on purpose is a success value, so the 404 from
  an unknown path, the csrf 403 and the timeout 504 all carry the headers. A
  true failure carries none.

## The middleware

Each global middleware lives in its own `src/server/*.ts`, and
`src/server/http.ts` chains it into `app`. `cors` is Effect's own
`HttpRouter.cors`. Effect ships no other middleware of these kinds, so the rest
are ports of the matching `hono/*` middleware with the options `apps/hono` uses.

| File | What it does | Departure from the Hono middleware |
| --- | --- | --- |
| `cors.ts` | One allowed origin, from `APP_URL`. Answers `OPTIONS` with a 204. | Effect's own middleware, not a port |
| `csrf.ts` | Header check, no token. 403 when the method, the content type, `Sec-Fetch-Site` and `Origin` all point at another site. | 403 returned, not raised |
| `secure-headers.ts` | The `SECURE_HEADERS` record. `X-Powered-By` removed. | none |
| `request-id.ts` | Trusts a well formed inbound `X-Request-Id`, generates a UUID if there is none, sends it back. | none |
| `language.ts` | `?lang=` then a `language` cookie then `Accept-Language`, over `en` and `id`. Writes the detected language back as a cookie. | own `Accept-Language` parser; `setCookieUnsafe` |
| `timing.ts` | A `Server-Timing` header on every response. Closes any open timer. | `crossOrigin` not ported |
| `timeout.ts` | 15 seconds, then a 504. Interrupts the fiber, so the abandoned work stops and its finalizers run. | `hono/timeout` races a `setTimeout` and lets the handler run on |

`src/server/secure-headers.ts` exports `SECURE_HEADERS`, and
`tests/app.test.ts` asserts the response against that record entry by entry. A
header added to the record is covered without a test edit, so do not copy the
set into a second place.

`src/server/language.test.ts`, `request-id.test.ts`, `timing.test.ts` and
`timeout.test.ts` cover the pure parts. `tests/app.test.ts` covers the wiring.

## Middleware order

A global middleware registers itself when its layer builds, and the
registrations wrap the router in that order. First registered is outermost.
`Layer.mergeAll` builds its members concurrently, so it would leave the nesting
to whichever layer won the race. `src/server/http.ts` therefore chains them with
`Layer.flatMap`, which builds one after another:

```
requestId → secureHeaders → cors → timing → timeout → language → csrf →
router → handler
```

`apps/hono` mounts the same middleware in this order, except for
`secureHeaders`.

Most behaviour here does not depend on the nesting. Cors answers `OPTIONS`
itself, and csrf treats `OPTIONS` as safe either way. Request id, secure
headers, timing and language detection reject nothing.

Three placements are deliberate:

- Timing is outside timeout, so a request that times out still carries a
  `Server-Timing` header.
- Timeout is inside cors, so the 504 carries the cors headers and a browser can
  read it.
- Secure headers is second. This is the one departure from the `apps/hono`
  order: that app mounts it after csrf, so a rejection there short-circuits
  before the headers are set and the 403 leaves without them. Out here it covers
  the csrf 403, the timeout 504 and the cors preflight. It reads nothing and
  answers nothing, so the move affects nothing else in the chain.

The nesting decides what a rejected request keeps, because a rejected request
never reaches the middleware inside it. A csrf 403 carries the request id, the
security headers, the cors headers and the timings, and no language cookie.
`tests/app.test.ts` asserts the request id, the security headers and the
timings, so a move in the chain fails a test.

## Built-in behaviour

- **Request logs** — `HttpRouter.serve` and `HttpRouter.toWebHandler` apply
  `HttpMiddleware.logger` unless you give them `disableLogger: true`. They apply
  it outside the router, so that log line carries no request id. Handler logs
  do.
- **Controlled shutdown** — `NodeRuntime.runMain` and `BunRuntime.runMain` catch
  `SIGINT` and `SIGTERM`, and `Layer.launch` runs the finalizers.
- **Schema failures as 400s** — a bad payload decodes to an `HttpApiSchemaError`
  response. You do not need error middleware.
- **The listen address in the log** — `HttpServer.withLogAddress`.

## Rate limit

There is none. `apps/hono` rate limits only its auth endpoints, through Better
Auth (`src/auth/utils/index.ts`), so there is no app-wide middleware to port.
This app has one public endpoint and no credentials. Add a rate limit with
`HttpMiddleware` or `HttpApiMiddleware` when the app needs one.
