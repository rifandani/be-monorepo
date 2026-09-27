import { NodeHttpServer } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";

import { LIVE_PATH } from "#api/health.ts";
import { app } from "#server/http.ts";
import { NOT_FOUND_MESSAGE } from "#server/not-found.ts";

/**
 * The composed app over a real socket.
 *
 * The third test idiom here, and the only one that runs the transport the app
 * ships on. `tests/health.test.ts` and `tests/app.test.ts` both build their
 * request from a web `Request`, where `originalUrl` is the absolute url the
 * client sent; under `NodeHttpServer` it is `req.url`, a bare path. So a
 * middleware that reads it is exercised by those two in a shape it never meets
 * in production — see `src/server/language.ts`, which documents the 500 that
 * fell through that gap.
 *
 * Each test below is one request field read by one middleware, plus the one
 * response that leaves by the failure path. Mount points and header composition
 * stay in `tests/app.test.ts`: neither varies by transport, so a second copy
 * here would prove nothing.
 *
 * Node only. `BunHttpServer.layerTest` exists, but `BunHttpServer.make` calls
 * `Bun.serve`, so it cannot build under this Node-hosted vitest. It would add
 * nothing today: Bun backs its request with a web `Request`, so its `url` and
 * `originalUrl` have the shape `tests/app.test.ts` already drives. Add a Bun
 * lane the day those two diverge.
 */

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

// `cors` and `csrf` read `APP_URL`, and this project runs its tests without an
// env file (see `vitest.config.ts`). Restated here rather than shared with
// `tests/app.test.ts`, so the policy under test stays in the file that asserts
// against it instead of becoming ambient again.
const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

// `layerTest` binds an ephemeral port and supplies an `HttpClient` already
// prefixed with the address it bound, which is why every request below is
// relative. It reads no `Config` of its own, so the provider above is the only
// environment this suite states. `provideMerge` and not `provide`: the client
// has to stay in the output for the tests to reach it.
const served = HttpRouter.serve(app.pipe(Layer.provide(configProvider)), {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const OK = { checks: [], status: "ok" };

// One socket for the file. `layer` builds in `beforeAll` and closes in
// `afterAll`, and each test still runs in a scope of its own; the app holds no
// state between requests, so a server per test would buy no isolation. The
// timeout sizes those two hooks, which is where the bind and the teardown land
// — a socket rather than a request, so it is set well above the request budget.
layer(served, { timeout: Duration.seconds(30) })(
  "the composed app over a node server",
  (it) => {
    // The baseline, and the case the `originalUrl` defect would have failed on
    // its own: `language` runs on every request, so a middleware that cannot
    // read this one cannot serve any of them.
    it.effect("serves the liveness probe", () =>
      Effect.gen(function* live() {
        const response = yield* HttpClient.get(LIVE_PATH);

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(yield* response.json, OK);
      })
    );

    // `request.url` — a path with the query still attached on both transports,
    // which is the property `queryLanguage` is written against.
    it.effect("reads the language from the query", () =>
      Effect.gen(function* query() {
        const response = yield* HttpClient.get(`${LIVE_PATH}?lang=id`);

        assert.strictEqual(response.status, 200);
        assert.include(response.headers["set-cookie"] ?? "", "language=id");
      })
    );

    // `request.cookies`, which each transport parses with its own accessor. The
    // `accept-language` header disagrees on purpose: the cookie is the
    // higher-priority source, so `en` coming back would say the cookies were
    // empty rather than that the negotiation ran.
    it.effect("reads the language from the cookie, over the header", () =>
      Effect.gen(function* cookie() {
        const response = yield* HttpClient.get(LIVE_PATH, {
          headers: { "accept-language": "en", cookie: "language=id" },
        });

        assert.strictEqual(response.status, 200);
        assert.include(response.headers["set-cookie"] ?? "", "language=id");
      })
    );

    // `request.headers`, and the one middleware that sends a request header back
    // out on the response.
    it.effect("keeps an inbound request id", () =>
      Effect.gen(function* requestId() {
        const id = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

        const response = yield* HttpClient.get(LIVE_PATH, {
          headers: { "x-request-id": id },
        });

        assert.strictEqual(response.headers["x-request-id"], id);
      })
    );

    // Method, `content-type`, `origin` and `sec-fetch-site` read together, and
    // the one case here that answers without reaching the router.
    //
    // Both halves are needed to say the last of those four is read at all: the
    // rejection alone would pass just as well if `sec-fetch-site` were never
    // looked at, because absent and cross-site both fail the same comparison.
    // The pair is what makes the header the only difference between a 403 and a
    // 200.
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

        // The browser saying the post came from the page it was served to is
        // what the app trusts, over the origin it cannot match.
        const allowed = yield* HttpClient.post(LIVE_PATH, {
          ...form,
          headers: { ...form.headers, "sec-fetch-site": "same-origin" },
        });

        assert.notStrictEqual(allowed.status, 403);
      })
    );

    // The one response that leaves by the failure path rather than the success
    // path: a `RouteNotFound` raised by the real router and turned into a
    // response by `notFound`, not by the synthetic failing routes
    // `tests/error.test.ts` mounts.
    it.effect("answers an unknown path with a 404", () =>
      Effect.gen(function* missing() {
        const response = yield* HttpClient.get("/nothing-here");

        assert.strictEqual(response.status, 404);
        assert.strictEqual(yield* response.text, NOT_FOUND_MESSAGE);
      })
    );
  }
);
