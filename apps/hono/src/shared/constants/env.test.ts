import { describe, expect, it } from "vitest";

import { InvalidEnvError, parseEnv } from "./env.ts";

const VALID = {
  APP_TITLE: "Hono",
  APP_URL: "https://hono.be-monorepo.localhost",
  BETTER_AUTH_SECRET: "secret",
  DATABASE_URL: "postgres://localhost:5432/app",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
  OTEL_LOG_LEVEL: "INFO",
};

const invalidVariables = (runtimeEnv: Record<string, string>) => {
  try {
    parseEnv(runtimeEnv);
  } catch (error) {
    if (error instanceof InvalidEnvError) {
      return error.variables;
    }

    throw error;
  }

  return [];
};

describe(parseEnv, () => {
  it("reports both wrong variables in one run", () => {
    expect(
      invalidVariables({ ...VALID, APP_TITLE: "", OTEL_LOG_LEVEL: "LOUD" })
    ).toStrictEqual(["APP_TITLE", "OTEL_LOG_LEVEL"]);
  });

  it("names every wrong variable in the error message", () => {
    expect(() =>
      parseEnv({ ...VALID, DATABASE_URL: "", MAX_IN_FLIGHT_PROBES: "-1" })
    ).toThrow(/DATABASE_URL[\s\S]*MAX_IN_FLIGHT_PROBES/u);
  });

  it("prefers the portless URL over APP_URL", () => {
    expect(
      parseEnv({ ...VALID, PORTLESS_URL: "https://portless.localhost" }).APP_URL
    ).toBe("https://portless.localhost");
  });

  it("fills the defaults of optional variables", () => {
    expect(parseEnv(VALID)).toMatchObject({
      MAX_IN_FLIGHT_PROBES: 8,
      MAX_IN_FLIGHT_REQUESTS: 256,
      NODE_ENV: "development",
    });
  });
});
