import { describe, expect, it } from "vitest";

import { app } from "@/app.js";

// Only better-auth's own database-free endpoints are exercised here: the point
// is that the wildcard mount reaches `auth.handler`, not that better-auth works.
// Anything touching a session needs a Postgres that CI has no container for.
describe("/api/auth/** handler", () => {
  it("hands GET requests to the better-auth handler", async () => {
    const res = await app.request("/api/auth/ok");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toStrictEqual({ ok: true });
  });

  it("hands POST requests to the better-auth handler", async () => {
    // Signing out without a session cookie is rejected by better-auth itself,
    // which is proof the POST reached it rather than falling through to 404.
    const res = await app.request("/api/auth/sign-out", { method: "POST" });

    expect(res.status).toBe(403);
  });

  it("returns 404 for a path better-auth does not know", async () => {
    const res = await app.request("/api/auth/does-not-exist");

    expect(res.status).toBe(404);
  });
});
