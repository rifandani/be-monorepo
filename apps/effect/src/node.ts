import { createServer } from "node:http";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { PORT } from "./config.js";
import { main } from "./main.js";

// `runMain` installs the SIGINT/SIGTERM handling and `Layer.launch` runs the
// finalizers, so there is no shutdown code to hand-roll here. Everything the two
// entrypoints share — the router, the probe tracer exclusion, telemetry, the
// banner — lives in `main.ts`.
Layer.launch(
  main(NodeHttpServer.layerConfig(createServer, { port: PORT }))
).pipe(NodeRuntime.runMain);
