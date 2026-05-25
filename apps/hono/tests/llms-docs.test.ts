import { describe, expect, it } from "vitest";

import { app } from "@/app.js";

import { parseServerTimingHeader } from "./util.js";

describe("/llms-docs endpoint", () => {
  it("should return the combined content of the docs folder and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms-docs");
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toStrictEqual(
      expect.objectContaining({
        length: expect.any(Number),
        text: expect.any(String),
        tokens: expect.any(Number),
      })
    );
    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });
});
