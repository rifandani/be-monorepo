import { afterAll, assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";

import { app } from "#app/http.ts";
import { LIVE_PATH, PREFIX, PROBES } from "#features/health/api.ts";
import { NOT_FOUND_MESSAGE } from "#server/not-found.ts";
import { SECURE_HEADERS } from "#server/secure-headers.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

const { dispose, handler } = HttpRouter.toWebHandler(
  app.pipe(Layer.provide([HttpServer.layerServices, configProvider])),
  { disableLogger: true }
);

const encodeSegment = (segment: string) =>
  `s-${encodeURIComponent(segment.toWellFormed())}`;

describe("app routes", () => {
  afterAll(async () => dispose());

  it("serves every declared probe where the probe policy expects it", async () => {
    const paths = Object.values(PROBES).map((probe) => probe.path);

    const answers = await Promise.all(
      paths.map(async (path) => {
        const response = await handler(new Request(`http://localhost${path}`));

        return {
          body: await response.json(),
          path,
          response,
          status: response.status,
        };
      })
    );

    for (const answer of answers) {
      assert.strictEqual(answer.status, 200, answer.path);
      assert.deepStrictEqual(answer.body, { checks: [], status: "ok" });
      assert.strictEqual(
        answer.response.headers.get("cache-control"),
        SECURE_HEADERS["cache-control"]
      );
    }
  });

  it("does not serve a bare /health", async () => {
    const response = await handler(new Request(`http://localhost${PREFIX}`));

    assert.strictEqual(response.status, 404);
  });

  it("has nothing at the root", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.strictEqual(response.status, 404);
    assert.strictEqual(await response.text(), NOT_FOUND_MESSAGE);
  });

  it.effect.prop(
    "should always answer any path under an unknown prefix with a 404",
    [Schema.Array(Schema.String)],
    ([segments]) =>
      Effect.gen(function* unknownPath() {
        const path = ["/nope", ...segments.map(encodeSegment)].join("/");

        const response = yield* Effect.promise(async () =>
          handler(new Request(`http://localhost${path}`))
        );

        assert.strictEqual(response.status, 404);
        assert.strictEqual(
          yield* Effect.promise(async () => response.text()),
          NOT_FOUND_MESSAGE
        );
      })
  );

  it("serves the OpenAPI document", async () => {
    const response = await handler(new Request("http://localhost/openapi"));

    const document = (await response.json()) as {
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };

    assert.strictEqual(response.status, 200);
    assert.strictEqual(document.info.title, "@workspace/effect");

    for (const probe of Object.values(PROBES)) {
      assert.isTrue(Object.hasOwn(document.paths, probe.path), probe.path);
    }
  });

  it("serves the Scalar reference page", async () => {
    const response = await handler(
      new Request("http://localhost/openapi/docs")
    );

    assert.strictEqual(response.status, 200);
    assert.isTrue(
      (response.headers.get("content-type") ?? "").includes("text/html")
    );
  });

  it("returns 404 for an unknown path", async () => {
    const response = await handler(new Request("http://localhost/nope"));

    assert.strictEqual(response.status, 404);
    assert.strictEqual(await response.text(), NOT_FOUND_MESSAGE);
  });

  it("answers a CORS preflight from the allowed origin", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
          "access-control-request-method": "POST",
        },
      })
    );

    assert.strictEqual(response.status, 204);
    assert.strictEqual(
      response.headers.get("access-control-allow-origin"),
      ALLOWED_ORIGIN
    );
    assert.strictEqual(
      response.headers.get("access-control-allow-credentials"),
      "true"
    );
  });

  it("adds the CORS headers to a plain request", async () => {
    const response = await handler(
      new Request(`http://localhost${LIVE_PATH}`, {
        headers: { origin: ALLOWED_ORIGIN },
      })
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get("access-control-allow-origin"),
      ALLOWED_ORIGIN
    );
    assert.strictEqual(
      response.headers.get("access-control-expose-headers"),
      "Content-Length"
    );
  });

  it("rejects a cross-site form post", async () => {
    const response = await handler(
      new Request("http://localhost/", { method: "POST" })
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(await response.text(), "Forbidden");
    assert.isNotNull(response.headers.get("x-request-id"));
  });

  it("allows a form post from the allowed origin", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
        },
      })
    );

    assert.strictEqual(response.status, 404);
  });

  it("allows a form post marked same-origin by the browser", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          "content-type": "multipart/form-data",
        },
      })
    );

    assert.strictEqual(response.status, 404);
  });

  it("does not guard a JSON post", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );

    assert.strictEqual(response.status, 404);
  });

  it("generates a request id and returns it", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );
  });

  it("keeps a well formed inbound request id", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        headers: { "x-request-id": "upstream-1=" },
      })
    );

    assert.strictEqual(response.headers.get("x-request-id"), "upstream-1=");
  });

  it("replaces an inbound request id it cannot trust", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        headers: { "x-request-id": "no spaces or punctuation!" },
      })
    );

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );
  });

  it("replaces an inbound request id that is too long", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        headers: { "x-request-id": "x".repeat(256) },
      })
    );

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );
  });

  it("times the request", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.match(
      response.headers.get("server-timing") ?? "",
      /^total;dur=\d+\.\d;desc="Total Response Time"$/u
    );
  });

  it("sends the security headers", async () => {
    const response = await handler(new Request("http://localhost/"));

    for (const [header, value] of Object.entries(SECURE_HEADERS)) {
      assert.strictEqual(response.headers.get(header), value);
    }
  });

  it("does not send Cross-Origin-Embedder-Policy", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.isNull(response.headers.get("cross-origin-embedder-policy"));
  });

  it("detects the language from the query and caches it", async () => {
    const response = await handler(new Request("http://localhost/?lang=id"));

    assert.include(response.headers.get("set-cookie") ?? "", "language=id");
  });

  it("negotiates the language from the header", async () => {
    const response = await handler(
      new Request("http://localhost/", {
        headers: { "accept-language": "fr;q=0.9, id;q=0.8" },
      })
    );

    assert.include(response.headers.get("set-cookie") ?? "", "language=id");
  });

  it("does not cache the fallback language", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.isNull(response.headers.get("set-cookie"));
  });
});
