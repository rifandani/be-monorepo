import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { HttpServerError, HttpServerRequest } from "effect/http";

import { isRouteNotFound, pathOf } from "./not-found.ts";

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

describe(pathOf, () => {
  it("drops the query string", () => {
    assert.strictEqual(pathOf("/nope?page=2&sort=asc"), "/nope");
  });

  it("keeps a path that has no query string", () => {
    assert.strictEqual(pathOf("/nope"), "/nope");
  });

  it.prop(
    "should always answer the url up to its first question mark",
    [Schema.String, Schema.String],
    ([path, query]) => {
      const bare = path.replaceAll("?", "");

      assert.strictEqual(pathOf(`${bare}?${query}`), bare);
    }
  );
});
