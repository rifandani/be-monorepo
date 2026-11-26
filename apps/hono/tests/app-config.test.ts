import { describe, expect, it } from "vitest";

import { createApp } from "#app/app.ts";
import { ENV } from "#shared/constants/env.ts";

const CUSTOM_URL = "https://custom-config.test";

const custom = await createApp({
  ...ENV,
  APP_TITLE: "Custom Config App",
  APP_URL: CUSTOM_URL,
});

const preflight = async (origin: string) =>
  custom.request("/llms.txt", {
    headers: {
      "Access-Control-Request-Method": "GET",
      Origin: origin,
    },
    method: "OPTIONS",
  });

describe("an app built from supplied config", () => {
  it("links refusals to the docs under the supplied URL", async () => {
    const res = await custom.request("/no-such-route");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ docs: `${CUSTOM_URL}/llms.txt` });
  });

  it("answers CORS preflight with the supplied origin only", async () => {
    const allowed = await preflight(CUSTOM_URL);
    const refused = await preflight(ENV.APP_URL);

    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(CUSTOM_URL);
    expect(refused.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("documents the supplied title and server in OpenAPI", async () => {
    const res = await custom.request("/openapi");
    const document = await res.json();

    expect(document).toMatchObject({
      info: { title: "Custom Config App" },
      servers: [{ url: CUSTOM_URL }],
    });
  });

  it("refuses a cross-site form post from the env origin", async () => {
    const res = await custom.request(
      "https://request-host.test/no-such-route",
      {
        body: new URLSearchParams({ name: "Ada Lovelace" }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: ENV.APP_URL,
        },
        method: "POST",
      }
    );

    expect(res.status).toBe(403);
  });
});
