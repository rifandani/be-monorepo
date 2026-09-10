import { afterAll, assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";

import { LIVE_PATH, PREFIX, READY_PATH, STARTUP_PATH } from "#api/health.ts";
import { app } from "#server/http.ts";
import { NOT_FOUND_MESSAGE } from "#server/not-found.ts";
import { SECURE_HEADERS } from "#server/secure-headers.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

// The cors layer reads `APP_URL`, and this project deliberately runs its tests
// without an env file (see `vitest.config.ts`). An explicit provider keeps that
// property: the policy under test is stated here, not in the ambient process.
const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

// `HttpApiTest.groups` (see `health.test.ts`) rebuilds the routes from the
// api description and never touches `app.ts`, so it cannot see a mount point
// move. This suite drives the composed layer instead, which is the only thing
// that fails when the OpenAPI or docs path regresses.
//
// `disableLogger` silences the per-request logging that `toWebHandler` applies
// by default; the requests here are assertions, not traffic worth reporting.
const { dispose, handler } = HttpRouter.toWebHandler(
  app.pipe(Layer.provide([HttpServer.layerServices, configProvider])),
  { disableLogger: true }
);

// What a short-circuited response carries — the 404's headers, and the csrf
// 403's — moved to `tests/nesting.test.ts`, where every such response is one
// row of one table. This suite keeps the mount points and each middleware's
// own behaviour.
describe("app routes", () => {
  afterAll(() => dispose());

  // The three probes are asserted here and not only in `tests/health.test.ts`,
  // which rebuilds the routes from the api description and so cannot see a
  // mount point move. These are the paths `quietProbes` excludes from the
  // traces and the log line, so this is what keeps the mount and the silence
  // policy on the same list.
  it("serves the three health probes where the probe policy expects them", async () => {
    const paths = [STARTUP_PATH, LIVE_PATH, READY_PATH];

    const answers = await Promise.all(
      paths.map(async (path) => {
        const response = await handler(new Request(`http://localhost${path}`));

        return { body: await response.json(), path, status: response.status };
      })
    );

    for (const answer of answers) {
      assert.strictEqual(answer.status, 200, answer.path);
      assert.deepStrictEqual(answer.body, { checks: [], status: "ok" });
    }
  });

  // There is deliberately no bare `/health`: an endpoint meaning "whichever of
  // the three you assumed" is the ambiguity the split exists to remove.
  it("does not serve a bare /health", async () => {
    const response = await handler(new Request(`http://localhost${PREFIX}`));

    assert.strictEqual(response.status, 404);
  });

  // The greeting that used to be here is gone, and `/` is now a miss like any
  // other path. Asserted rather than left implied, because a redirect to the
  // docs would be a guess about who is calling.
  it("has nothing at the root", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.strictEqual(response.status, 404);
    assert.strictEqual(await response.text(), NOT_FOUND_MESSAGE);
  });

  it("serves the OpenAPI document", async () => {
    const response = await handler(new Request("http://localhost/openapi"));
    const document = (await response.json()) as {
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };

    assert.strictEqual(response.status, 200);
    assert.strictEqual(document.info.title, "@workspace/effect");
    for (const path of [STARTUP_PATH, LIVE_PATH, READY_PATH]) {
      assert.isTrue(Object.hasOwn(document.paths, path), path);
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

  // Every endpoint the api has is a GET, so a POST that clears the CSRF check
  // reaches the router and stops at 404. That is the point of the assertions
  // below: 403 means the middleware rejected it, 404 means it let it through.
  it("rejects a cross-site form post", async () => {
    const response = await handler(
      new Request("http://localhost/", { method: "POST" })
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(await response.text(), "Forbidden");
    // csrf is the innermost middleware, so a rejection still carries what the
    // ones outside it add. See the nesting in `src/server/http.ts`.
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

  // A form element cannot send this content type, so the same-origin policy
  // already covers it and CORS governs the rest.
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

  // The record is the contract, so the test reads it rather than repeating it:
  // an entry added there is asserted here without an edit.
  it("sends the security headers", async () => {
    const response = await handler(new Request("http://localhost/"));

    for (const [header, value] of Object.entries(SECURE_HEADERS)) {
      assert.strictEqual(response.headers.get(header), value);
    }
  });

  // `require-corp` would block every cross-origin resource that does not opt
  // in. It is off in `apps/hono` too.
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

  // Caching the fallback would pin a client that stated no preference to `en`,
  // which is the one case that should keep negotiating.
  it("does not cache the fallback language", async () => {
    const response = await handler(new Request("http://localhost/"));

    assert.isNull(response.headers.get("set-cookie"));
  });
});
