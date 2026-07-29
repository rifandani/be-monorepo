import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { identifyMiddleware } from "./identify.js";

describe(identifyMiddleware, () => {
  // The route tests already cover the path where evlog has populated `log`.
  // This is the other side: mounted without evlog ahead of it, the middleware
  // must pass the request through rather than identify against a missing log.
  it("passes the request through when no log is on the context", async () => {
    const app = new Hono();
    app.use("*", identifyMiddleware());
    app.get("/anonymous", (c) => c.text("reached the handler"));

    const res = await app.request("/anonymous");

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("reached the handler");
  });
});
