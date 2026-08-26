import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";

import { Api } from "../src/api/api.js";
import { Greetings } from "../src/server/greetings.js";
import { greetingsHandlersNoDeps } from "../src/server/greetings/http.js";

// `HttpApiTest.groups` builds a typed client wired straight to the handlers,
// using the real request encoding, routing and response decoding — but without
// binding a port. `HttpServer.layerServices` supplies the platform services
// that pipeline needs (FileSystem, Path, Etag, HttpPlatform).
const makeClient = HttpApiTest.groups(Api, ["greetings"]);

// The handlers are taken without their dependencies and `Greetings.layer` is
// provided here, which is the seam a test uses to swap the implementation for
// a stub once the service does something worth stubbing.
const handlers = greetingsHandlersNoDeps.pipe(Layer.provide(Greetings.layer));

layer(Layer.mergeAll(handlers, HttpServer.layerServices))("greetings", (it) => {
  it.effect("returns the greeting", () =>
    Effect.gen(function* hello() {
      const client = yield* makeClient;

      const greeting = yield* client.greetings.hello();

      assert.deepStrictEqual(greeting, { message: "Hello World" });
    })
  );
});
