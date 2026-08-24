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

// `void shutdown(0)` used to discard the promise here; oxlint 1.79 turns
// `no-void` on, and a rejection had nowhere to go anyway.
const handleSignal = async () => {
  try {
    await shutdown(0);
  } catch (error: unknown) {
    log.error(
      "node-server",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
};

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
