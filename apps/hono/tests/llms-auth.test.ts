import { describe, expect, it } from "vitest";

import { app } from "@/app.js";

import { parseServerTimingHeader } from "./util.js";

describe("/llms-auth.txt endpoint", () => {
  it("should return the auth schema and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms-auth.txt");
    const text = await res.text();
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);

    expect(res.status).toBe(200);
    expect(text).toMatch(/# Better Auth/u);
    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });
});
