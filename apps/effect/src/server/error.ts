import { Cause, Effect } from "effect";
import type { Types } from "effect";
import {
  HttpBody,
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/http";

export const SERVER_ERROR_MESSAGE = "Internal Server Error";
const SERVER_ERROR_STATUS = 500;

export const errorMessage = (
  status: number,
  cause: Cause.Cause<unknown>
): string =>
  status >= SERVER_ERROR_STATUS
    ? SERVER_ERROR_MESSAGE
    : (Cause.prettyErrors(cause)[0]?.message ?? SERVER_ERROR_MESSAGE);

export const toErrorResponse = Effect.fn("toErrorResponse")(
  function* errorResponse(cause: Cause.Cause<unknown>) {
    const [response] = yield* HttpServerError.causeResponse(cause);

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

export const onError = HttpRouter.middleware(
  (
    httpEffect
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled> =>
    Effect.catchCause(httpEffect, toErrorResponse),
  { global: true }
);
