import { Effect } from "effect";
import { HttpRouter, HttpServerError, HttpServerResponse } from "effect/http";

export const NOT_FOUND_MESSAGE = "404 Not found";

const NOT_FOUND = HttpServerResponse.text(NOT_FOUND_MESSAGE, { status: 404 });

export const isRouteNotFound = (
  error: unknown
): error is HttpServerError.HttpServerError & {
  readonly reason: HttpServerError.RouteNotFound;
} =>
  HttpServerError.isHttpServerError(error) &&
  error.reason._tag === "RouteNotFound";

export const notFound = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () =>
        Effect.as(Effect.logWarning(NOT_FOUND_MESSAGE), NOT_FOUND)
      )
    ),
  { global: true }
);
