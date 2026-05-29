import { describe, expect, it } from "vitest";

import { app } from "@/app.js";
import { ENV } from "@/core/constants/env.js";

import { parseServerTimingHeader } from "./util.js";

describe("/llms.txt endpoint", () => {
  it("should return the OpenAPI docs and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms.txt");
    const text = await res.text();
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);
    const regex = new RegExp(ENV.APP_TITLE, "u");

    expect(res.status).toBe(200);
    expect(text).toMatch(regex);
    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });
});
