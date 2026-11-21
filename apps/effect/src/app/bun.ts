import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";

import { PORT } from "#shared/config.ts";

import { main } from "./main.ts";

BunRuntime.runMain(
  Layer.launch(main(BunHttpServer.layerConfig({ port: PORT })))
);
