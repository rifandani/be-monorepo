import { describe, expect, it } from "bun:test";
import { app } from "@/app.js";
import { parseServerTimingHeader } from "./util.js";

describe("/llms-docs endpoint", () => {
  it("should return the combined content of the docs folder and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms-docs");
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        length: expect.any(Number),
        tokens: expect.any(Number),
      })
    );
    expect(dur).not.toBeNull();
    expect(dur!).toBeLessThan(1000);
  });
});
