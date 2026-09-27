import { Effect } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/unstable/http";

/**
 * The body an unknown path is answered with.
 *
 * The string `apps/hono` sends from `app.notFound` (`src/app.ts`), so both apps
 * answer a miss the same way. Exported because `tests/app.test.ts` asserts
 * against it rather than repeating it.
 */
export const NOT_FOUND_MESSAGE = "404 Not found";

// Built once: an `HttpServerResponse` is a value, and this one never varies.
const NOT_FOUND = HttpServerResponse.text(NOT_FOUND_MESSAGE, { status: 404 });

/**
 * True when the failure is the router reporting that no route matched.
 *
 * `HttpRouter` fails with one `HttpServerError` for every kind of request
 * level problem and names the kind in `reason`, so the tag has to be read one
 * level down. Separate from the middleware below so the test can state the
 * cases without building a request.
 */
// `unknown` on purpose, and this rule reads that as an unparsed input. The
// error channel a global middleware sees is `Types.unhandled`, a marker with no
// runtime value, so there is no domain type to name here — the guard below is
// the parse.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const isRouteNotFound = (error: unknown): boolean =>
  HttpServerError.isHttpServerError(error) &&
  error.reason._tag === "RouteNotFound";

/**
 * The unknown path handler, with the same behaviour as `apps/hono`
 * (`app.notFound` in `src/app.ts`): a warning in the log, then a 404 carrying
 * the same text.
 *
 * Effect answers a miss on its own — `HttpServerError.causeResponse` maps
 * `RouteNotFound` to a 404 — but it answers with an empty body and no log
 * line. This turns the failure into a response instead, which is what puts the
 * text in the body and, because the response is a success value, what makes the
 * 404 carry the request id, the security headers and the timings. See the third
 * convention in `docs/http-api.md`.
 *
 * `Effect.catchIf` and not `Effect.catchCause`: a miss is the one failure this
 * module claims, and everything else has to stay in the channel for `error.ts`
 * outside it. The predicate is not a type guard because the error channel a
 * global middleware sees is a marker type, not the router's error type; see the
 * note in `error.ts`.
 */
export const notFound = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () =>
        Effect.as(Effect.logWarning(NOT_FOUND_MESSAGE), NOT_FOUND)
      )
    ),
  { global: true }
);
