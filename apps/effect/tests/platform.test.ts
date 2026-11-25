import { NodeHttpServer } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import { app } from "#app/http.ts";
import { LIVE_PATH } from "#features/health/api.ts";
import { NOT_FOUND_MESSAGE } from "#server/not-found.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

const served = HttpRouter.serve(app.pipe(Layer.provide(configProvider)), {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const OK = { checks: [], status: "ok" };

layer(served, { timeout: Duration.seconds(30) })(
  "the composed app over a node server",
  (it) => {
    it.effect("serves the liveness probe", () =>
      Effect.gen(function* live() {
        const response = yield* HttpClient.get(LIVE_PATH);

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(yield* response.json, OK);
      })
    );

    it.effect("reads the language from the query", () =>
      Effect.gen(function* query() {
        const response = yield* HttpClient.get(`${LIVE_PATH}?lang=id`);

        assert.strictEqual(response.status, 200);
        assert.include(response.headers["set-cookie"] ?? "", "language=id");
      })
    );

    it.effect("reads the language from the cookie, over the header", () =>
      Effect.gen(function* cookie() {
        const response = yield* HttpClient.get(LIVE_PATH, {
          headers: { "accept-language": "en", cookie: "language=id" },
        });

        assert.strictEqual(response.status, 200);
        assert.include(response.headers["set-cookie"] ?? "", "language=id");
      })
    );

    it.effect("keeps an inbound request id", () =>
      Effect.gen(function* requestId() {
        const id = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

        const response = yield* HttpClient.get(LIVE_PATH, {
          headers: { "x-request-id": id },
        });

        assert.strictEqual(response.headers["x-request-id"], id);
      })
    );

    it.effect("rejects a cross-site form post, and only a cross-site one", () =>
      Effect.gen(function* csrf() {
        const form = {
          body: HttpBody.urlParams({ lang: "id" }),
          headers: { origin: "https://evil.example" },
        };

        const rejected = yield* HttpClient.post(LIVE_PATH, {
          ...form,
          headers: { ...form.headers, "sec-fetch-site": "cross-site" },
        });

        assert.strictEqual(rejected.status, 403);
        assert.strictEqual(yield* rejected.text, "Forbidden");

        const allowed = yield* HttpClient.post(LIVE_PATH, {
          ...form,
          headers: { ...form.headers, "sec-fetch-site": "same-origin" },
        });

        assert.notStrictEqual(allowed.status, 403);
      })
    );

    it.effect("answers an unknown path with a 404", () =>
      Effect.gen(function* missing() {
        const response = yield* HttpClient.get("/nothing-here");

        assert.strictEqual(response.status, 404);
        assert.strictEqual(
          ((yield* response.json) as { message: string }).message,
          NOT_FOUND_MESSAGE
        );
      })
    );
  }
);
