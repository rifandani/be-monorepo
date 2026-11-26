import { createEnv } from "@t3-oss/env-core";
import type { StandardSchemaV1 } from "@t3-oss/env-core";
import { z } from "zod";

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

const SERVER = {
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
};

const VARIABLES = Object.keys(SERVER);

const variableOf = (issue: StandardSchemaV1.Issue) =>
  VARIABLES.find((name) => issue.path?.includes(name) === true) ?? "(unknown)";

export class InvalidEnvError extends Error {
  readonly variables: readonly string[];

  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    const variables = issues.map(variableOf);

    super(
      `Invalid environment variables:\n${issues
        .map((issue, index) => `  ${variables[index]}: ${issue.message}`)
        .join("\n")}`
    );
    this.name = "InvalidEnvError";
    this.variables = variables;
  }
}

export const parseEnv = (runtimeEnv: RuntimeEnv) =>
  createEnv({
    onValidationError: (issues) => {
      throw new InvalidEnvError(issues);
    },
    runtimeEnv: {
      ...runtimeEnv,
      APP_URL: runtimeEnv.PORTLESS_URL ?? runtimeEnv.APP_URL,
    },
    server: SERVER,
  });

export const ENV = parseEnv(process.env);

export type AppConfig = Pick<
  typeof ENV,
  "APP_TITLE" | "APP_URL" | "MAX_IN_FLIGHT_PROBES" | "MAX_IN_FLIGHT_REQUESTS"
>;
