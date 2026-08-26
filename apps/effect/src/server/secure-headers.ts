import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

/**
 * The headers `hono/secure-headers` sends when a caller names no options, which
 * is how `apps/hono` mounts it (`src/app.ts`).
 *
 * Lowercase keys because that is how Effect keys a header. Header names are
 * case insensitive, so the response carries the same names `apps/hono` sends.
 *
 * Exported so a test can state the set once rather than repeat it.
 *
 * One default of that middleware is deliberately absent:
 * `Cross-Origin-Embedder-Policy`. It is off there too — `require-corp` blocks
 * every cross-origin resource that does not opt in, which is a decision a page
 * makes, not an api.
 */
export const SECURE_HEADERS = {
  // Only this origin may embed a response of ours in its documents.
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  // Asks the browser to keep this origin in an agent cluster of its own.
  "origin-agent-cluster": "?1",
  // Never leak the url a request came from, not even to ourselves.
  "referrer-policy": "no-referrer",
  // 180 days, the `hono/secure-headers` default. Ignored over plain http, so
  // it costs nothing in development.
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  // `0` and not `1; mode=block`: the legacy auditor this header drives is
  // itself an XSS vector, so the modern advice is to turn it off outright.
  "x-xss-protection": "0",
} as const;

// `removePoweredBy`, the last default of `hono/secure-headers`. Effect sets no
// `X-Powered-By` of its own, so this only matters for a handler or a proxy that
// adds one — which is exactly when it should go.
const POWERED_BY = "x-powered-by";

/**
 * Security response headers, with the same policy as `apps/hono`
 * (`src/app.ts`): the defaults of `hono/secure-headers`.
 *
 * Effect has no secure headers middleware, so this is a port. It is a flat set
 * of constants, which is why the whole of it is the record above — nothing here
 * reads the request.
 *
 * The options not ported are the ones `apps/hono` does not use:
 * `contentSecurityPolicy` and its report-only twin, `permissionsPolicy`,
 * `reportingEndpoints`, `reportTo` and the CSP `NONCE` helper. Every one of
 * them describes what a document may load, and this service answers with JSON.
 * Add them here, as more entries in the record, the day it serves html.
 *
 * `Effect.map` runs only on success, as in `request-id.ts` and `timing.ts`: a
 * request that fails outright carries no security headers. Every response this
 * app produces on purpose — the 404 from an unknown path, the 403 from `csrf`,
 * the 504 from `timeout` — is a success value, so it carries them.
 */
export const secureHeaders = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.map((response) =>
        HttpServerResponse.removeHeader(
          HttpServerResponse.setHeaders(response, SECURE_HEADERS),
          POWERED_BY
        )
      )
    ),
  { global: true }
);
