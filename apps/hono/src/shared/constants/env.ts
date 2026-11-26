import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const ENV = createEnv({
  runtimeEnv: {
    ...process.env,
    APP_URL: process.env.PORTLESS_URL ?? process.env.APP_URL,
  },
  server: {
    APP_TITLE: z.string().min(1),
    APP_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.string().min(1).default("development"),
    MAX_IN_FLIGHT_PROBES: z.coerce.number().int().positive().default(8),
    MAX_IN_FLIGHT_REQUESTS: z.coerce.number().int().positive().default(256),
    PORT: z.coerce.number().int().positive().optional(),
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

export type AppConfig = Pick<
  typeof ENV,
  "APP_TITLE" | "APP_URL" | "MAX_IN_FLIGHT_PROBES" | "MAX_IN_FLIGHT_REQUESTS"
>;
