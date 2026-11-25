import { createError } from "evlog";
import * as fc from "fast-check";
import { HTTPException } from "hono/http-exception";
import { HTTPError, TimeoutError } from "ky";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { app } from "#app/app.ts";

app.get("/__test/zod", () => {
  z.object({ name: z.string() }).parse({ name: 42 });

  return new Response("unreachable");
});

app.get("/__test/zod-nested", () => {
  z.object({
    address: z.object({ lines: z.array(z.string()) }),
  }).parse({ address: { lines: [7] } });

  return new Response("unreachable");
});

app.get("/__test/ky", () => {
  const error = new HTTPError(
    Response.json({ detail: "upstream rejected it" }, { status: 400 }),
    new Request("https://upstream.example/resource"),
    { method: "get" } as never
  );

  error.data = { detail: "upstream rejected it" };

  throw error;
});

app.get("/__test/ky-unreadable", () => {
  throw new HTTPError(
    new Response(null, { status: 502 }),
    new Request("https://upstream.example/resource"),
    { method: "get" } as never
  );
});

app.get("/__test/ky-timeout", () => {
  throw new TimeoutError(new Request("https://upstream.example/resource"));
});

app.get("/__test/http-exception", () => {
  throw new HTTPException(403, { message: "forbidden by policy" });
});

app.get("/__test/unknown", () => {
  throw new Error("something unhandled");
});

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

app.get("/__test/contentless", () => {
  throw createError({
    message: "Nothing to see",
    status: 204,
    why: "a bodiless status on an error",
  });
});

app.get("/__test/lang", (c) => c.text(c.get("language")));

describe("app error handling", () => {
  it("answers a ZodError as a refusal that names the field and the fix", async () => {
    const res = await app.request("/__test/zod");

    const body = (await res.json()) as {
      fix: string;
      location: string;
      message: string;
    };

    expect(res.status).toBe(400);
    expect(body.message).toContain("name");
    expect(body.location).toBe("name");
    expect(body.fix).toContain("name");
  });

  it("names the nested path of the first rejected field", async () => {
    const res = await app.request("/__test/zod-nested");
    const body = (await res.json()) as { location: string };

    expect(body.location).toBe("address.lines.0");
  });

  it("answers an upstream rejection as an infrastructure fault", async () => {
    const res = await app.request("/__test/ky");

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Bad Gateway",
    });
  });

  it("answers an unreadable upstream body as an infrastructure fault", async () => {
    const res = await app.request("/__test/ky-unreadable");

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Bad Gateway",
    });
  });

  it("answers an upstream timeout as an infrastructure fault", async () => {
    const res = await app.request("/__test/ky-timeout");

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Gateway Timeout",
    });
  });

  it("lets an HTTPException render its own response", async () => {
    const res = await app.request("/__test/http-exception");

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain("forbidden by policy");
  });

  it("answers any other error as a defect with no detail", async () => {
    const res = await app.request("/__test/unknown");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Internal Server Error",
    });
  });

  it("carries the error's own status and every hint it supplies", async () => {
    const res = await app.request("/__test/hinted");

    expect(res.status).toBe(402);
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

  it("answers 500 with the hints when the error's status cannot carry a body", async () => {
    const res = await app.request("/__test/contentless");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toStrictEqual({
      message: "Nothing to see",
      why: "a bodiless status on an error",
    });
  });
});

describe("app not-found handling", () => {
  it("answers an unrouted path with a 404", async () => {
    const res = await app.request("/no-such-route");

    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe("404 Not found");
  });

  it("should always answer any path under an unrouted prefix with a 404", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.webSegment()), async (segments) => {
        const path = [
          "/no-such-route",
          ...segments.map((segment) => `s-${encodeURIComponent(segment)}`),
        ].join("/");

        const res = await app.request(path);

        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe("404 Not found");
      })
    );
  });
});

describe("app language detection", () => {
  it("detects Indonesian from Accept-Language and falls back to English", async () => {
    const id = await app.request("/__test/lang", {
      headers: { "Accept-Language": "id" },
    });

    const fallback = await app.request("/__test/lang", {
      headers: { "Accept-Language": "fr" },
    });

    await expect(id.text()).resolves.toBe("id");
    await expect(fallback.text()).resolves.toBe("en");
  });
});
