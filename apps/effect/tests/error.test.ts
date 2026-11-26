import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { onError, SERVER_ERROR_MESSAGE } from "#server/error.ts";
import { requestId } from "#server/request-id.ts";

const failing = Layer.mergeAll(
  HttpRouter.add("GET", "/die", Effect.die(new Error("connect ECONNREFUSED"))),
  HttpRouter.add("GET", "/interrupt", Effect.interrupt),
  HttpRouter.add(
    "GET",
    "/refuse",
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.fail(
        new HttpServerError.HttpServerError({
          reason: new HttpServerError.RequestParseError({
            description: "expected a JSON body",
            request,
          }),
        })
      )
    )
  ),
  HttpRouter.add(
    "GET",
    "/teapot",
    Effect.die(HttpServerResponse.text("I am a teapot", { status: 418 }))
  ),
  Layer.flatMap(requestId, () => onError)
);

const { dispose, handler } = HttpRouter.toWebHandler(
  failing.pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true }
);

describe("error handler", () => {
  afterAll(async () => dispose());

  it("answers a defect with a 500 and JSON", async () => {
    const response = await handler(new Request("http://localhost/die"));

    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), {
      message: SERVER_ERROR_MESSAGE,
    });
  });

  it("gives the error response the headers of the middleware outside it", async () => {
    const response = await handler(new Request("http://localhost/die"));

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );
  });

  it("answers an interrupted request as an infrastructure fault", async () => {
    const response = await handler(new Request("http://localhost/interrupt"));

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(await response.json(), {
      message: "Service Unavailable",
    });
  });

  it("answers a refused request with the location and a fix", async () => {
    const response = await handler(new Request("http://localhost/refuse"));

    const body = (await response.json()) as {
      fix: string;
      location: string;
      message: string;
    };

    assert.strictEqual(response.status, 400);
    assert.strictEqual(body.location, "body");
    assert.include(body.message, "expected a JSON body");
    assert.isNotEmpty(body.fix);
  });

  it("leaves a response the handler chose alone", async () => {
    const response = await handler(new Request("http://localhost/teapot"));

    assert.strictEqual(response.status, 418);
    assert.strictEqual(await response.text(), "I am a teapot");
  });
});
