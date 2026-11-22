import { SpanKind, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "#app/app.ts";
import { ENV } from "#shared/constants/env.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/constants/global.ts";

const postFormFromOrigin = async (origin: string) =>
  app.request("https://request-host.test/no-such-route", {
    body: new URLSearchParams({ name: "Ada Lovelace" }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    method: "POST",
  });

describe("app middleware configuration", () => {
  it("answers CORS preflight with the configured origin", async () => {
    const res = await app.request("/llms.txt", {
      method: "OPTIONS",
      headers: {
        Origin: ENV.APP_URL,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
      },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.APP_URL);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
      "Content-Length"
    );
  });

  it("allows the configured CORS request headers", async () => {
    const res = await app.request("/llms.txt", {
      method: "OPTIONS",
      headers: {
        Origin: ENV.APP_URL,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
      },
    });

    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type"
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization"
    );
  });

  it("allows the configured CORS methods", async () => {
    const res = await app.request("/llms.txt", {
      method: "OPTIONS",
      headers: {
        Origin: ENV.APP_URL,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain(
      "OPTIONS"
    );
  });

  it("reflects CORS credentials on a simple cross-origin GET", async () => {
    const res = await app.request("/llms.txt", {
      headers: { Origin: ENV.APP_URL },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.APP_URL);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});

describe("app csrf protection", () => {
  it("should let a form POST from the configured origin reach routing", async () => {
    const res = await postFormFromOrigin(ENV.APP_URL);

    expect(res.status).toBe(404);
  });

  it("should reject a form POST from another origin with a 403", async () => {
    const res = await postFormFromOrigin("https://attacker.example");

    expect(res.status).toBe(403);
  });
});

describe("app http instrumentation", () => {
  const exporter = new InMemorySpanExporter();

  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });

  beforeAll(() => {
    if (!trace.setGlobalTracerProvider(provider)) {
      throw new Error("Another global tracer provider is already registered");
    }
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it("should tag the request span with the service name and version", async () => {
    exporter.reset();

    await app.request("/llms.txt");

    const span = exporter
      .getFinishedSpans()
      .find(({ kind }) => kind === SpanKind.SERVER);

    expect(span?.attributes).toMatchObject({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    });
  });
});
