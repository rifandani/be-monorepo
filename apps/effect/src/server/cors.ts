import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { ALLOWED_ORIGIN } from "#server/origin.ts";

/**
 * CORS, with the same policy as `apps/hono` (`src/app.ts`): one allowed origin,
 * read from the environment.
 *
 * `HttpRouter.cors` registers a global middleware, so it covers the OpenAPI
 * document and the Scalar page as well as the api groups. It answers every
 * `OPTIONS` request itself with a 204, which is why `allowedMethods` only
 * advertises the policy and does not gate the preflight.
 *
 * The Allowed Origin comes from `origin.ts`, which `csrf.ts` also reads and
 * which states the `url.origin` rule the two of them share.
 *
 * One entry in `allowedOrigins`, and Effect treats that as a licence rather
 * than a comparison: with exactly one allowed origin it sends
 * `access-control-allow-origin` on every response without ever looking at the
 * request's own `Origin` (`HttpMiddleware.ts:333-352` in the vendored source).
 * That is correct — the browser is what refuses a mismatch — but it means the
 * header on a response is not evidence that cors approved anything, only that
 * the response came back out through this middleware. The csrf row in
 * `tests/nesting.test.ts` reads it that way and says so.
 *
 * The layer is `Layer.unwrap`ped because the origin comes from a `Config`, which
 * is an `Effect`. A missing `APP_URL` therefore fails the layer build — the same
 * startup failure the other consumers of `config.ts` have — instead of silently
 * falling back to the `*` that an empty `allowedOrigins` means here.
 */
export const cors = Layer.unwrap(
  // `pipe` rather than `Effect.map(ALLOWED_ORIGIN, ...)`: oxlint reads the
  // second argument of a two-argument `map` as an array `thisArg` and reports
  // it.
  ALLOWED_ORIGIN.pipe(
    Effect.map((origin) =>
      HttpRouter.cors({
        allowedHeaders: ["Content-Type", "Authorization"],
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedOrigins: [origin],
        credentials: true,
        exposedHeaders: ["Content-Length"],
      })
    )
  )
);
