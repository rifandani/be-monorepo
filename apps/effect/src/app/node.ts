import { createServer } from "node:http";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { PORT } from "#shared/config.ts";

import { main } from "./main.ts";

NodeRuntime.runMain(
  Layer.launch(main(NodeHttpServer.layerConfig(createServer, { port: PORT })))
);
