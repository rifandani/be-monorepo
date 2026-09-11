import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";

import { PORT } from "./config.ts";
import { main } from "./main.ts";

// The composition lives in `main.ts` and is shared with `node.ts`. The one
// runtime-specific note: `observability` uses `NodeSdk` here too, because it
// needs `AsyncLocalStorage`, which Bun implements — so one telemetry module
// serves both entrypoints and there is no `WebSdk` anywhere.
Layer.launch(main(BunHttpServer.layerConfig({ port: PORT }))).pipe(
  BunRuntime.runMain
);
