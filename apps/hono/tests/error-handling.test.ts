import { createError } from "evlog";
import { HTTPException } from "hono/http-exception";
import { HTTPError } from "ky";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { app } from "@/app.js";

// Routes registered with `get` rather than `openapi` stay out of the OpenAPI
// document, so they cannot leak into the /openapi or /llms.txt assertions in
// the sibling test files that share this app instance.
app.get("/__test/zod", () => {
  z.object({ name: z.string() }).parse({ name: 42 });
  return new Response("unreachable");
});

app.get("/__test/ky", () => {
  throw new HTTPError(
    Response.json({ detail: "upstream rejected it" }, { status: 400 }),
    new Request("https://upstream.example/resource"),
    // ky only reads `method` off the options when building its message.
    { method: "get" } as never
  );
});

app.get("/__test/http-exception", () => {
  throw new HTTPException(403, { message: "forbidden by policy" });
});

app.get("/__test/unknown", () => {
  throw new Error("something unhandled");
});

// `parseError` lifts `why`/`fix`/`link` to the top level only for an
// `EvlogError`; a plain Error leaves them undefined, which is why the
// `/__test/unknown` case above never reaches the hint-carrying branches.
app.get("/__test/hinted", () => {
  throw createError({
    code: "PAYMENT_DECLINED",
    fix: "Try a different payment method",
    link: "https://docs.example.test/payments",
    message: "Payment failed",
    status: 402,
    why: "Card declined by issuer",
  });
});

app.get("/__test/partly-hinted", () => {
  throw createError({
    message: "Half hinted",
    status: 418,
    why: "just because",
  });
});

describe("app error handling", () => {
  it("turns a ZodError into a 400 with the prettified issues", async () => {
    const res = await app.request("/__test/zod");
    const body = (await res.json()) as { message: string };

    expect(res.status).toBe(400);
    expect(body.message).toContain("name");
  });

  it("turns a ky HTTPError into a 400 carrying the upstream body", async () => {
    const res = await app.request("/__test/ky");
    const body = (await res.json()) as {
      error: { detail: string };
      message: string;
    };

    expect(res.status).toBe(400);
    expect(body.error.detail).toBe("upstream rejected it");
    expect(body.message).toBeTruthy();
  });

  it("lets an HTTPException render its own response", async () => {
    const res = await app.request("/__test/http-exception");

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain("forbidden by policy");
  });

  it("falls back to the parsed error shape for anything else", async () => {
    const res = await app.request("/__test/unknown");
    const body = (await res.json()) as { message: string };

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.message).toBeTruthy();
  });

  it("carries the error's own status and every hint it supplies", async () => {
    const res = await app.request("/__test/hinted");

    expect(res.status).toBe(402);
    // `toStrictEqual` rather than per-key assertions: the point is that the
    // body holds these keys and no others, so a refactor cannot start leaking
    // `code` or `raw` from the parsed error into the response unnoticed.
    await expect(res.json()).resolves.toStrictEqual({
      fix: "Try a different payment method",
      link: "https://docs.example.test/payments",
      message: "Payment failed",
      why: "Card declined by issuer",
    });
  });

  it("omits the hints the error does not supply", async () => {
    const res = await app.request("/__test/partly-hinted");

    expect(res.status).toBe(418);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Half hinted",
      why: "just because",
    });
  });
});

describe("app not-found handling", () => {
  it("answers an unrouted path with a 404", async () => {
    const res = await app.request("/no-such-route");

    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe("404 Not found");
  });
});
