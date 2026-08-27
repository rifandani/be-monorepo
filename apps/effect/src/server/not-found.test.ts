import { assert, describe, it } from "@effect/vitest";
import { HttpServerError, HttpServerRequest } from "effect/unstable/http";

import { isRouteNotFound } from "./not-found.js";

// The middleware itself is covered end to end by `tests/app.test.ts`, which is
// the only place a real route miss happens. What is worth testing here is the
// predicate that decides what the middleware claims — every other failure has
// to travel on to `error.ts`.
const request = HttpServerRequest.fromWeb(new Request("http://localhost/nope"));

const httpServerError = (reason: HttpServerError.HttpServerErrorReason) =>
  new HttpServerError.HttpServerError({ reason });

describe(isRouteNotFound, () => {
  it("claims a route miss", () => {
    assert.isTrue(
      isRouteNotFound(
        httpServerError(new HttpServerError.RouteNotFound({ request }))
      )
    );
  });

  // The router reports every request level problem as one `HttpServerError`, so
  // reading the outer tag alone would swallow a 400 and answer it as a 404.
  it("leaves another HttpServerError reason alone", () => {
    assert.isFalse(
      isRouteNotFound(
        httpServerError(new HttpServerError.RequestParseError({ request }))
      )
    );
    assert.isFalse(
      isRouteNotFound(
        httpServerError(new HttpServerError.InternalError({ request }))
      )
    );
  });

  it("leaves anything that is not an HttpServerError alone", () => {
    assert.isFalse(isRouteNotFound(new Error("RouteNotFound")));
    assert.isFalse(isRouteNotFound({ reason: { _tag: "RouteNotFound" } }));
    assert.isFalse(isRouteNotFound("RouteNotFound"));
  });
});
