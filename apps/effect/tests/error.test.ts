import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http";

import { onError, SERVER_ERROR_MESSAGE } from "../src/server/error.js";
import { requestId } from "../src/server/request-id.js";

// `app` has no route that fails, so the catch-all in `src/server/error.ts` has
// nothing to catch there. This suite mounts routes that do, over the same
// middleware, and it mounts `requestId` outside `onError` to check the other
// half of the placement: an error response is a success value by the time the
// outer middleware sees it, so it carries their headers.
const failing = Layer.mergeAll(
  HttpRouter.add("GET", "/die", Effect.die(new Error("connect ECONNREFUSED"))),
  HttpRouter.add("GET", "/interrupt", Effect.interrupt),
  HttpRouter.add(
    "GET",
    "/teapot",
    // Dying with a response is how a handler answers a failure itself.
    Effect.die(HttpServerResponse.text("I am a teapot", { status: 418 }))
  ),
  requestId.pipe(Layer.flatMap(() => onError))
);

const { dispose, handler } = HttpRouter.toWebHandler(
  failing.pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true }
);

describe("error handler", () => {
  afterAll(() => dispose());

  it("answers a defect with a 500 and JSON", async () => {
    const response = await handler(new Request("http://localhost/die"));

    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), {
      message: SERVER_ERROR_MESSAGE,
    });
  });

  // This is what the innermost placement buys. Left to Effect, the 500 would
  // travel past `requestId` as a failure and leave without the header.
  it("gives the error response the headers of the middleware outside it", async () => {
    const response = await handler(new Request("http://localhost/die"));

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );
  });

  // An interrupt fails no error channel either, so it is the third case a catch
  // on the error channel alone would miss.
  it("answers an interrupted request", async () => {
    const response = await handler(new Request("http://localhost/interrupt"));

    assert.strictEqual(response.status, 503);
  });

  it("leaves a response the handler chose alone", async () => {
    const response = await handler(new Request("http://localhost/teapot"));

    assert.strictEqual(response.status, 418);
    assert.strictEqual(await response.text(), "I am a teapot");
  });
});
