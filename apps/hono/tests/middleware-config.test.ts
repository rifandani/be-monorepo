import { describe, expect, it } from "vitest";

import { app } from "@/app.js";
import { ENV } from "@/core/constants/env.js";

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
