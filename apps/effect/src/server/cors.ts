import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { APP_URL } from "../config.js";

/**
 * CORS, with the same policy as `apps/hono` (`src/app.ts`): one allowed origin,
 * read from the environment.
 *
 * `HttpRouter.cors` registers a global middleware, so it covers the OpenAPI
 * document and the Scalar page as well as the api groups. It answers every
 * `OPTIONS` request itself with a 204, which is why `allowedMethods` only
 * advertises the policy and does not gate the preflight.
 *
 * `url.origin` rather than `url.toString()`: a `URL` stringifies with a
 * trailing slash, and a browser sends `Origin` without one, so the full string
 * would never match.
 *
 * The layer is `Layer.unwrap`ped because the origin comes from a `Config`, which
 * is an `Effect`. A missing `APP_URL` therefore fails the layer build — the same
 * startup failure the other consumers of `config.ts` have — instead of silently
 * falling back to the `*` that an empty `allowedOrigins` means here.
 */
export const cors = Layer.unwrap(
  // `pipe` rather than `Effect.map(APP_URL, ...)`: oxlint reads the second
  // argument of a two-argument `map` as an array `thisArg` and reports it.
  APP_URL.pipe(
    Effect.map((url) =>
      HttpRouter.cors({
        allowedHeaders: ["Content-Type", "Authorization"],
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedOrigins: [url.origin],
        credentials: true,
        exposedHeaders: ["Content-Length"],
      })
    )
  )
);
