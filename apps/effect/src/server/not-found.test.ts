import { assert, describe, it } from "@effect/vitest";
import { HttpServerError, HttpServerRequest } from "effect/http";

import { isRouteNotFound } from "./not-found.ts";

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
    assert.isFalse(
      isRouteNotFound({
        reason: new HttpServerError.RouteNotFound({ request }),
      })
    );
    assert.isFalse(isRouteNotFound("RouteNotFound"));
  });
});
