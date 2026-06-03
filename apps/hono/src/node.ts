import { serve } from "@hono/node-server";
import { log } from "evlog";

import { PORT } from "@/core/constants/global.js";

import { app } from "./app.js";
import { shutdownObservability } from "./instrumentation.js";

const server = serve({ ...app, port: PORT }, (info) => {
  log.info(
    "node-server",
    `Started development server: http://localhost:${info.port}`
  );
});

let isShuttingDown = false;

const shutdown = async (exitCode: number) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  await shutdownObservability();
  server.close((err) => {
    if (err) {
      log.error("node-server", err.message);
      process.exit(1);
    }
    process.exit(exitCode);
  });
};

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
