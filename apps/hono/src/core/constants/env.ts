import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const ENV = createEnv({
  // PORTLESS_URL is injected by `portless` (incl. worktree subdomain prefixes).
  runtimeEnv: {
    ...process.env,
    APP_URL: process.env.PORTLESS_URL ?? process.env.APP_URL,
  },
  server: {
    APP_TITLE: z.string().min(1),
    APP_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().min(1),
    OTEL_LOG_LEVEL: z.enum([
      "ALL",
      "VERBOSE",
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
      "NONE",
    ]),
  },
});
