import { Effect, Predicate } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

export const NOT_FOUND_MESSAGE = "404 Not found";

const NOT_FOUND_FIX =
  "Check the method and the path against the OpenAPI document at /openapi.";

export const isRouteNotFound = (
  error: unknown
): error is HttpServerError.HttpServerError & {
  readonly reason: HttpServerError.RouteNotFound;
} =>
  HttpServerError.isHttpServerError(error) &&
  Predicate.isTagged(error.reason, "RouteNotFound");

const QUERY = /\?.*/su;

export const pathOf = (url: string): string => url.replace(QUERY, "");

export const notFound = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          Effect.as(
            Effect.logInfo(NOT_FOUND_MESSAGE),
            HttpServerResponse.jsonUnsafe(
              {
                fix: NOT_FOUND_FIX,
                location: pathOf(request.url),
                message: NOT_FOUND_MESSAGE,
              },
              { status: 404 }
            )
          )
        )
      )
    ),
  { global: true }
);
