import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  OpenApi,
} from "effect/http-api";

import { Api } from "#app/api.ts";

import { findInputOperationsWithout400 } from "../../../vitest.openapi.ts";

const Widget = Schema.Struct({ name: Schema.String });

const documentOf = (endpoint: HttpApiEndpoint.Constraint) =>
  OpenApi.fromApi(
    HttpApi.make("test").add(HttpApiGroup.make("widgets").add(endpoint))
  );

describe("OpenApi.fromApi(Api)", () => {
  it("should declare a 400 response for every operation that accepts input", () => {
    const missing = findInputOperationsWithout400(OpenApi.fromApi(Api));

    assert.deepStrictEqual(missing, []);
  });
});

describe(findInputOperationsWithout400, () => {
  it("should flag an endpoint with a payload that omits 400", () => {
    const doc = documentOf(
      HttpApiEndpoint.post("create", "/widgets", {
        payload: Widget,
        success: Widget,
      })
    );

    const missing = findInputOperationsWithout400(doc);

    assert.deepStrictEqual(missing, ["POST /widgets"]);
  });

  it("should accept an endpoint with a payload that declares BadRequest", () => {
    const doc = documentOf(
      HttpApiEndpoint.post("create", "/widgets", {
        error: HttpApiError.BadRequest,
        payload: Widget,
        success: Widget,
      })
    );

    const missing = findInputOperationsWithout400(doc);

    assert.deepStrictEqual(missing, []);
  });

  it("should flag an endpoint with path params that omits 400", () => {
    const doc = documentOf(
      HttpApiEndpoint.get("read", "/widgets/:id", {
        params: { id: Schema.String },
        success: Widget,
      })
    );

    const missing = findInputOperationsWithout400(doc);

    assert.deepStrictEqual(missing, ["GET /widgets/{id}"]);
  });

  it("should flag an endpoint with a query that omits 400", () => {
    const doc = documentOf(
      HttpApiEndpoint.get("list", "/widgets", {
        query: { page: Schema.String },
        success: Schema.Array(Widget),
      })
    );

    const missing = findInputOperationsWithout400(doc);

    assert.deepStrictEqual(missing, ["GET /widgets"]);
  });
});
