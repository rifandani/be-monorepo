import { describe, expect, it } from "vitest";

import { app } from "@/app.js";

import { parseServerTimingHeader } from "./util.js";

describe("/llms.txt endpoint", () => {
  it("should return the OpenAPI docs and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms.txt");
    const text = await res.text();
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);

    expect(res.status).toBe(200);
    expect(text).toMatch(/# Hono API - Development/u);
    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });
});
