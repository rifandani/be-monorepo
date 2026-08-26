import { createServer } from "node:http";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { APP_TITLE, APP_URL, PORT } from "./config.js";
import { app } from "./server/http.js";

// `HttpServer.withLogAddress`, which `HttpRouter.serve` applies, reports the
// socket the process bound to. That is not the address a developer opens —
// portless terminates TLS on a `.localhost` subdomain and forwards here — so
// this logs the public URL alongside it.
const banner = Effect.gen(function* banner() {
  const title = yield* APP_TITLE;
  const url = yield* APP_URL;

  yield* Effect.log(`${title} is reachable at ${url.toString()}`);
});

const server = HttpRouter.serve(app).pipe(
  Layer.provide(NodeHttpServer.layerConfig(createServer, { port: PORT })),
  Layer.merge(Layer.effectDiscard(banner))
);

// `runMain` installs the SIGINT/SIGTERM handling and `Layer.launch` runs the
// finalizers, so there is no shutdown code to hand-roll here.
Layer.launch(server).pipe(NodeRuntime.runMain);
