---
status: accepted
---

# Global middleware reads `request.url`

The global middlewares in `apps/effect/src/server` read `HttpServerRequest.url` and parse it themselves. They do not read `originalUrl`, they do not call `new URL` on a request url, and they do not use Effect's two search-parameter facilities. `pathOf` in `probes.ts` and `queryLanguage` in `language.ts` are the two places this matters.

This is written down because every obvious alternative is wrong in a way that tests do not catch.

## Why not `new URL(request.originalUrl)`

`originalUrl` is not the same kind of value under the two runtimes. For a request built from a web `Request` — which is what `HttpRouter.toWebHandler` serves, and what most of this app's tests drive — it is the absolute url the client sent. Under `NodeHttpServer` it is the raw `req.url`, which is a bare path. So `new URL` on it resolves under `toWebHandler` and throws `TypeError: Invalid URL` on a real Node server.

This is not a hypothetical. `language.ts` was written that way once, and the defect was reproduced again on purpose while writing this ADR:

- `tests/app.test.ts` — 22 of 22 passed.
- `tests/platform.test.ts` — every request failed, the liveness probe and the language case among them, each with `expected 500 to equal 200`. The csrf 403 case and the 404 case also came back 500.

The throw never reaches the client or the assertion. `server/error.ts` converts an undeclared failure into a bare 500 with no detail, on purpose, so what an operator sees is a server that answers 500 to everything with no message anywhere. That is why the whole test suite staying green is the dangerous part: `tests/platform.test.ts` exists to serve the app over a real socket, and it is the only thing that fences this.

`request.url` is `urlOverride ?? removeHost(originalUrl)` on the web side and `req.url` on the node side (`HttpServerRequest.ts:719` in the vendored source), so it is a path with a query attached under both. `URLSearchParams` over the part after the `?` needs no host at all.

## Why not `ParsedSearchParams`

`HttpServerRequest.ParsedSearchParams` is the framework's parsed query, and it is unavailable to a global middleware by construction: `HttpRouter` adds it to the context only on a **matched route** (`HttpRouter.ts:215`). A global middleware wraps the whole router from outside, runs before any match, and has to serve requests that never match at all — `language.ts` sets the language on a 404 as much as on a 200, which `tests/nesting.test.ts` asserts. Taking `ParsedSearchParams` would make it a requirement the middleware cannot satisfy.

## Why not `HttpMiddleware.searchParamsParser`

That middleware exists precisely to provide `ParsedSearchParams` outside a route, which makes it the natural answer to the paragraph above. It is built on `Request.searchParamsFromURL(new URL(request.originalUrl))` (`HttpMiddleware.ts:300`), so adopting it reintroduces the defect this ADR opens with — inside framework code, where the app's own comments cannot warn anyone.

## Why not `layerTracerDisabledForUrls`

Effect's own probe-exclusion helper compares the whole url, and `request.url` carries the query, so `/health/live?x=1` escapes every exclusion. `pathOf` cuts the query and the fragment first, which is what makes `probes.ts` compare paths to paths. See **Probe Silence** in `apps/effect/CONTEXT.md`.

## Consequences

- Two small url parsers stay hand-written, `pathOf` and `queryLanguage`, with 13 test cases between them. An architecture review proposed merging them into one adapter; that was declined for a separate reason — each one's output has exactly one consumer and nothing concentrates — but this ADR is why neither can be replaced by a platform call.
- `tests/platform.test.ts` is load-bearing. It is the only suite that runs the app over a real socket, and the only one that can see this class of defect. Do not thin it out on the grounds that `tests/app.test.ts` covers the same routes.
- If a future Effect release makes `originalUrl` absolute under `NodeHttpServer`, or gives `searchParamsParser` a path-safe implementation, this decision is worth reopening. Check the vendored source rather than the release notes.
