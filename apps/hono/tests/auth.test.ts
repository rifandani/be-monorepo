import { describe, expect, it } from "vitest";

import { app } from "#app/app.ts";

describe("/api/auth/** handler", () => {
  it("hands GET requests to the better-auth handler", async () => {
    const res = await app.request("/api/auth/ok");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toStrictEqual({ ok: true });
  });

  it("hands POST requests to the better-auth handler", async () => {
    const res = await app.request("/api/auth/sign-out", { method: "POST" });

    expect(res.status).toBe(403);
  });

  it("returns 404 for a path better-auth does not know", async () => {
    const res = await app.request("/api/auth/does-not-exist");

    expect(res.status).toBe(404);
  });
});
