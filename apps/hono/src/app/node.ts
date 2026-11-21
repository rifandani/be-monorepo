import { serve } from "@hono/node-server";
import { log } from "evlog";

import { shutdownObservability } from "#server/instrumentation.ts";
import { PORT } from "#shared/constants/global.ts";

import { app } from "./app.ts";

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
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

const handleSignal = () => {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- errors caught from a promise are unknown by TypeScript; narrow before logging.
  void shutdown(0).catch((error: unknown) => {
    log.error(
      "node-server",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
};

process.on("SIGINT", handleSignal);

process.on("SIGTERM", handleSignal);
