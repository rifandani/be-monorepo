import { Cause, Effect } from "effect";
import type { Types } from "effect";
import {
  HttpBody,
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/unstable/http";

/**
 * The body every 5xx answers with.
 *
 * A server failure's own message names the module, the query or the upstream
 * host that broke. None of that is the client's business, and all of it is in
 * the log line this middleware writes. A client error is the other case: the
 * client can act on which field failed, so that message is passed on.
 *
 * This is the one departure from `apps/hono`, which returns the message of
 * whatever it caught (`app.onError` in `src/app.ts`).
 */
export const SERVER_ERROR_MESSAGE = "Internal Server Error";
const SERVER_ERROR_STATUS = 500;

/** The message the client is told, for a response of `status`. */
export const errorMessage = (
  status: number,
  cause: Cause.Cause<unknown>
): string =>
  status >= SERVER_ERROR_STATUS
    ? SERVER_ERROR_MESSAGE
    : // `prettyErrors` renders every reason; the first is the failure that
      // decided the status, which is the one worth reporting.
      (Cause.prettyErrors(cause)[0]?.message ?? SERVER_ERROR_MESSAGE);

/**
 * The response a failed request is answered with, and the log line that goes
 * with it.
 *
 * Separate from the middleware below so a test can drive it with a `Cause` and
 * no request.
 *
 * `HttpServerError.causeResponse` decides the status, and it is left to: it
 * already maps a parse failure to 400, an unknown path to 404, a client that
 * hung up to 499, a shutdown to 503 and anything else to 500, and it honours a
 * `Respondable` error that picks its own. What it does not do is give the
 * response a body, so the JSON goes on here — and only when the status carries
 * none, so a handler that answered on purpose is never overwritten.
 */
export const toErrorResponse = Effect.fn("toErrorResponse")(
  function* errorResponse(cause: Cause.Cause<unknown>) {
    const [response] = yield* HttpServerError.causeResponse(cause);

    // A `Cause` passed to a log function becomes the line's cause rather than
    // part of its message, so the stack and the annotations survive.
    yield* Effect.logError("Request failed", cause);

    return response.body._tag === "Empty"
      ? HttpServerResponse.setBody(
          response,
          HttpBody.jsonUnsafe({
            message: errorMessage(response.status, cause),
          })
        )
      : response;
  }
);

/**
 * The error handler, with the same behaviour as `apps/hono` (`app.onError` in
 * `src/app.ts`): every failure is logged, then answered as JSON.
 *
 * `Effect.catchCause` and not `Effect.catch`, because a handler that throws
 * fails no error channel — it dies — and a request the client abandoned is
 * neither. All three have to become a response.
 *
 * The return type is written out, and it is the reason this reads oddly.
 * `HttpRouter.middleware` hands a global middleware an error channel of
 * `Types.unhandled`, a marker with no runtime value, and rejects a middleware
 * that removes it: catching every cause would leave `never`, which is the one
 * thing the constraint refuses. Widening the result back to the marker is legal
 * — the channel is covariant, and there was never a value in it — and it says
 * what is true: nothing reaches the router's own handling any more.
 *
 * This is the second-innermost middleware, with only `notFound` inside it, and
 * that is deliberate. See the chain in `chain.ts`.
 */
export const onError = HttpRouter.middleware(
  (
    httpEffect
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled> =>
    Effect.catchCause(httpEffect, toErrorResponse),
  { global: true }
);
