---
status: accepted
---

# Global middleware are ports of the Hono middleware

Effect has no middleware for CORS, CSRF, request id, secure headers, timeout, timing, language or error bodies. Each module in `src/server/` is a port of the `hono/*` middleware that `apps/hono` mounts in `src/app/app.ts`, with the options that app uses. Both apps must answer the same request in the same way. The sections below record each place where a port differs from the obvious implementation, and each place where it differs from `apps/hono` on purpose.

## Rules for every port

- **A rejection is a response, not a failure.** The csrf 403, the timeout 504 and the 404 are success values. A failure would widen the error channel out to whatever serves the app. The client sees the same response.
- **Headers are set with `Effect.map`.** It runs only on success. Every response that the app makes on purpose is a success value, so it carries the headers.
- **Header names are lowercase.** Effect keys headers in lowercase. Header names are case insensitive, so the response carries the same names that `apps/hono` sends.
- **Per-request state is a `Context.Reference`.** Its default makes it readable everywhere without a requirement on every caller and every test. `Context.Reference` caches what `defaultValue` returns, so the default must be a value, never mutable state. A mutable default is one instance that every caller outside a request shares, and nothing drains it. A reference that carries mutable per-request state needs `undefined` as its default.
- **`globalThis.crypto.randomUUID` and `performance.now`, not the `Crypto` and `Clock` services.** `Crypto` has no default, so it adds a requirement through `app`, both entrypoints and every test. A correlation token and a duration do not need a swappable source. `Clock` reports wall time in milliseconds: it prints `dur=0.0` for most requests and can step backwards. `performance.now` is monotonic and sub-millisecond, and `hono/timing` uses it too. `metrics.ts` reads the same clock as `timing.ts`. Use `Crypto.Crypto` with `NodeCrypto.layer` and `BunCrypto.layer` if the id must be pinned.
- **`Effect.suspend` in `timing` and `metrics` is necessary.** A global middleware wraps the router once, at layer build. A clock read outside `suspend` is one start time for every request.

## Allowed Origin (`origin.ts`)

`cors.ts` and `csrf.ts` both read the **Allowed Origin**. Neither owns it. It is `url.origin` of `APP_URL`, not `url.toString()`: a `URL` stringifies with a trailing slash, and a browser sends `Origin` without one. A path or a query on `APP_URL` is dropped, because an origin is scheme, host and port only.

It is a `Config`, not an `Effect` or a service. Both consumers need the value at layer build, before a request exists. A missing `APP_URL` fails the layer build, the same startup failure as every other reader of `config.ts`. It is a policy premise, so it is in `server/`, inside the coverage denominator, and not in the excluded `config.ts`.

## CORS (`cors.ts`)

`HttpRouter.cors` registers a global middleware, so it covers the OpenAPI document and the Scalar page too. It answers every `OPTIONS` request with a 204, so `allowedMethods` only advertises the policy.

With exactly one entry in `allowedOrigins`, Effect sends `access-control-allow-origin` on every response and does not compare the request `Origin` (`HttpMiddleware.ts:333-352` in the vendored source). This is correct, because the browser refuses a mismatch. But the header shows only that the response went back out through `cors`, not that `cors` approved it.

The layer is `Layer.unwrap`ped because the origin is a `Config`. An empty `allowedOrigins` means `*`, so a missing `APP_URL` must fail the build and not fall back.

## CSRF (`csrf.ts`)

A port of `hono/csrf`: a header check, not a token. A request is rejected only when every test agrees that it is a cross-site form post, in the same order as `hono/csrf`:

- The content type is one that an HTML form can send without a preflight. Other types, such as `application/json`, cannot leave a form, so the same-origin policy and CORS already govern them.
- A request with no `Content-Type` counts as `text/plain`, as a form sends it.
- The request has neither `Sec-Fetch-Site: same-origin` nor an `Origin` equal to the Allowed Origin. A page on another site cannot forge either header.
- `OPTIONS` is safe, so a CORS preflight is never rejected.

CORS and CSRF stay separate layers. See [ADR-0003](./0003-cors-and-csrf-stay-separate-layers.md).

## Request id (`request-id.ts`)

Trust an inbound `X-Request-Id` when it is well formed, generate a UUID when it is not, and send it back. Trusting the inbound header lets an id survive a hop, which is the only reason to have one. The bounds are the ones `hono/request-id` applies. An id goes into logs and into the response, so an unbounded or unescaped client id is a log injection.

`HttpRouter.serve` and `toWebHandler` apply `HttpMiddleware.logger` outside the router. The framework's per-request log line therefore does not carry the id. Handler logs do. To change this, pass the middleware through the `middleware` option of those functions.

## Secure headers (`secure-headers.ts`)

The headers that `hono/secure-headers` sends with no options, which is how `apps/hono` mounts it. The set is a flat record of constants, exported so that a test states it once.

- `Cross-Origin-Embedder-Policy` is absent. It is off in `apps/hono` too. `require-corp` blocks every cross-origin resource that does not opt in, and that is a decision for a page, not for an API.
- `Cache-Control`, `Pragma` and `Expires` mark dynamic API responses as not cacheable (ZAP rule 10015). `apps/hono` sets a different policy on its llms routes because that content is cacheable.
- `Strict-Transport-Security` is 180 days, the `hono/secure-headers` default. Browsers ignore it over plain http.
- `X-XSS-Protection` is `0`, not `1; mode=block`. The legacy auditor is itself an XSS vector.
- `X-Powered-By` is removed. Effect sets none, so this matters only when a handler or a proxy adds one.
- Not ported: `contentSecurityPolicy` and its report-only form, `permissionsPolicy`, `reportingEndpoints`, `reportTo` and the CSP `NONCE` helper. They describe what a document may load, and this service answers JSON. Add them to the record when the app serves html.

## Timeout (`timeout.ts`)

15 seconds, then a 504 with the status and body of `hono/timeout`. The value is a `Duration`, not `15_000`, because a written unit cannot be misread.

This port is stronger than `hono/timeout`. That middleware races `next()` against `setTimeout`, so the abandoned handler keeps running: its queries, outbound requests and writes continue. `Effect.timeoutOrElse` interrupts the fiber, so the work stops and its finalizers run. `timeoutOrElse`, not `timeout`, because `timeout` fails with `TimeoutError` and widens the error channel.

`withTimeout` and the layer factory take a duration so that a test can drive them. No route in this app is slow enough to time out, so a test builds the layer with a short duration over its own router to see a real 504.

## Timing (`timing.ts`)

`Server-Timing` with the total only, described as `Total Response Time`, with the name and precision of `hono/timing`. The handler API of `hono/timing` (`setMetric`, `startTime`/`endTime`, `wrapTime`) was ported and then removed: no handler recorded anything, `apps/hono` calls none of it, and 120 lines were reachable only from their own test. Port it again when a handler has a duration worth sending. It needs a mutable collector per request, which a `Context.Reference` default cannot hold.

`crossOrigin` is not ported. It sends `Timing-Allow-Origin`, which is a CORS decision.

## Language (`language.ts`)

The languages and fallback of `apps/hono` (`en` and `id`, fallback `en`) with the default precedence of `hono/language`: `?lang=` wins over the `language` cookie, which wins over `Accept-Language`. Query first makes a link shareable in one language. Cookie next makes a choice stick.

- A detected language is written back as a cookie with the options of `hono/language`. A fallback is not: a cookie would pin a client that stated no preference to `en`.
- Matching is case insensitive and accepts a region subtag. A prefix counts only at a subtag boundary (`en` matches `en-GB`, not `england`). The longest supported prefix wins, so a future `zh-Hant` beats `zh`.
- The `Accept-Language` parser splits on separators. It does not use the `parseAccept` tokenizer of Hono, which also handles quoted strings and parameters for `Accept`. A malformed `q` falls back to 1. `sort` is stable, so equal qualities keep the client order.
- The query is read from `request.url`. See [ADR-0004](./0004-global-middleware-reads-request-url.md).
- The cookie is set with `setCookieUnsafe`. `setCookie` fails with `CookiesError`, which widens the error channel, and the value is one of the supported languages, which always encodes.
- The supported list is not exported. `Language` is the exported surface. Move the list to `shared/` when a handler needs the set.

## Error handler (`error.ts`)

Every failure is logged, then answered as JSON, as `app.onError` does in `apps/hono`. `Effect.catchCause`, not `Effect.catch`: a throwing handler dies and does not fail, and an abandoned request is neither. All three need a response.

- `HttpServerError.causeResponse` decides the status: 400 for a parse failure, 404 for an unknown path, 499 when the client hung up, 503 on shutdown, 500 otherwise, and a `Respondable` error picks its own. This module only adds a JSON body, and only when the response has none, so a handler that answered on purpose is not overwritten. The response builder is separate from the middleware so that a test drives it with a `Cause`.
- **The one difference from `apps/hono`:** a 5xx body does not carry the failure message. That message names the module, the query or the upstream host that broke, and it goes to the log. A 4xx body keeps its message, because the client can act on it.
- The message is the first reason from `prettyErrors`, which is the failure that decided the status.
- The `Cause` is passed to the log function, so the stack and the annotations stay on the log line.
- The return type is written out. `HttpRouter.middleware` gives a global middleware the error channel `Types.unhandled` and rejects a middleware that removes it. Catching every cause leaves `never`. Widening back to the marker is legal, because the channel is covariant and never held a value.

## Not found (`not-found.ts`)

A warning in the log, then a 404 with the text that `app.notFound` sends in `apps/hono`. Effect maps `RouteNotFound` to a 404 itself, but with an empty body and no log line. As a success value, the 404 also carries the request id, the security headers and the timings.

`HttpRouter` fails with one `HttpServerError` for every request-level problem and puts the kind in `reason`. The predicate reads one level down, so a 400 is not answered as a 404. It is separate from the middleware so that a test states the cases without a request. Its parameter is `unknown`, because `Types.unhandled` has no runtime value; the guard is the parse step.
