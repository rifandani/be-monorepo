import { serve } from "@hono/node-server";
import { log } from "evlog";

import { shutdownObservability } from "#server/instrumentation.ts";
import { ENV } from "#shared/constants/env.ts";
import { messageOf } from "#shared/utils/message-of.ts";

import { app } from "./app.ts";

const server = serve({ fetch: app.fetch, port: ENV.PORT }, (info) => {
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

const exitAfterFailedShutdown = (cause: unknown) => {
  log.error("node-server", messageOf(cause));
  process.exit(1);
};

const handleSignal = () => {
  void shutdown(0).catch(exitAfterFailedShutdown);
};

process.on("SIGINT", handleSignal);

process.on("SIGTERM", handleSignal);
