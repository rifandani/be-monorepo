import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { Variables } from "@/core/types/hono.js";

import { identifyMiddleware } from "./identify.js";

interface FakeLog {
  set: ReturnType<typeof vi.fn<(value: unknown) => void>>;
}

const appWithLog = (log: FakeLog) => {
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", (c, next) => {
    c.set("log", log as unknown as Variables["log"]);
    return next();
  });
  app.use("*", identifyMiddleware());
  app.get("/api/things", (c) => c.text("reached"));
  app.get("/api/auth/session-check", (c) => c.text("auth"));
  app.get("/api/health", (c) => c.text("health"));
  app.get("/api/public/ping", (c) => c.text("public"));
  return app;
};

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

  it("resolves identity on included /api paths when log is present", async () => {
    const log: FakeLog = { set: vi.fn<(value: unknown) => void>() };
    const app = appWithLog(log);

    const res = await app.request("/api/things");

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("reached");
    // getSession fails without a DB, but the middleware still records the attempt.
    expect(log.set).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ identified: false }),
      })
    );
  });

  it("skips better-auth routes listed in exclude", async () => {
    const log: FakeLog = { set: vi.fn<(value: unknown) => void>() };
    const app = appWithLog(log);

    await app.request("/api/auth/session-check");

    expect(log.set).not.toHaveBeenCalled();
  });

  it("skips /api/health listed in exclude", async () => {
    const log: FakeLog = { set: vi.fn<(value: unknown) => void>() };
    const app = appWithLog(log);

    await app.request("/api/health");

    expect(log.set).not.toHaveBeenCalled();
  });

  it("skips /api/public/** listed in exclude", async () => {
    const log: FakeLog = { set: vi.fn<(value: unknown) => void>() };
    const app = appWithLog(log);

    await app.request("/api/public/ping");

    expect(log.set).not.toHaveBeenCalled();
  });
});
