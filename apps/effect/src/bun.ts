import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { APP_TITLE, APP_URL, PORT } from "./config.js";
import { app } from "./server/http.js";

// See the note in `node.ts`: this reports the portless URL, not the bound port.
const banner = Effect.gen(function* banner() {
  const title = yield* APP_TITLE;
  const url = yield* APP_URL;

  yield* Effect.log(`${title} is reachable at ${url.toString()}`);
});

const server = HttpRouter.serve(app).pipe(
  Layer.provide(BunHttpServer.layerConfig({ port: PORT })),
  Layer.merge(Layer.effectDiscard(banner))
);

Layer.launch(server).pipe(BunRuntime.runMain);
