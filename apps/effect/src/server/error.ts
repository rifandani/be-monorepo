import { Cause, Effect, Option, Predicate } from "effect";
import type { Types } from "effect";
import {
  HttpBody,
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/http";

import { pathOf } from "./not-found.ts";

export const SERVER_ERROR_MESSAGE = "Internal Server Error";
const REFUSAL_MIN = 400;
const REFUSAL_MAX = 499;
const REFUSAL_FIX = "Correct the request and send it again.";

const FAULT_MESSAGES: ReadonlyMap<number, string> = new Map([
  [502, "Bad Gateway"],
  [503, "Service Unavailable"],
  [504, "Gateway Timeout"],
]);

export type FailureClass = "refusal" | "fault" | "defect";

export const failureClass = (status: number): FailureClass => {
  if (status >= REFUSAL_MIN && status <= REFUSAL_MAX) {
    return "refusal";
  }

  return FAULT_MESSAGES.has(status) ? "fault" : "defect";
};

export const errorMessage = (
  status: number,
  cause: Cause.Cause<unknown>
): string => {
  const failure = failureClass(status);

  if (failure === "refusal") {
    return Cause.prettyErrors(cause)[0]?.message ?? SERVER_ERROR_MESSAGE;
  }

  return FAULT_MESSAGES.get(status) ?? SERVER_ERROR_MESSAGE;
};

const refusalLocation = (cause: Cause.Cause<unknown>): string | undefined => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));

  if (!HttpServerError.isHttpServerError(error)) {
    return undefined;
  }

  return Predicate.isTagged(error.reason, "RouteNotFound")
    ? pathOf(error.reason.request.url)
    : "body";
};

const errorBody = (status: number, cause: Cause.Cause<unknown>) => {
  const message = errorMessage(status, cause);

  if (failureClass(status) !== "refusal") {
    return { message };
  }

  const location = refusalLocation(cause);

  return location === undefined
    ? { fix: REFUSAL_FIX, message }
    : { fix: REFUSAL_FIX, location, message };
};

const logFailure = (status: number, cause: Cause.Cause<unknown>) => {
  const failure = failureClass(status);

  if (failure === "refusal") {
    return Effect.logInfo("Request refused", cause);
  }

  if (failure === "fault") {
    return Effect.logWarning("Request failed on a dependency", cause);
  }

  return Effect.logError("Request failed", cause);
};

export const toErrorResponse = Effect.fn("toErrorResponse")(
  function* errorResponse(cause: Cause.Cause<unknown>) {
    const [response] = yield* HttpServerError.causeResponse(cause);

    yield* logFailure(response.status, cause);

    return Predicate.isTagged(response.body, "Empty")
      ? HttpServerResponse.setBody(
          response,
          HttpBody.jsonUnsafe(errorBody(response.status, cause))
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
