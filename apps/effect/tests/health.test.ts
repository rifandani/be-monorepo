import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";

import { Api } from "../src/api/api.js";
import { Unhealthy } from "../src/domain/health.js";
import { Health } from "../src/server/health.js";
import { healthHandlersNoDeps } from "../src/server/health/http.js";

// `HttpApiTest.groups` builds a typed client wired straight to the handlers,
// using the real request encoding, routing and response decoding — but without
// binding a port. `HttpServer.layerServices` supplies the platform services
// that pipeline needs (FileSystem, Path, Etag, HttpPlatform).
const makeClient = HttpApiTest.groups(Api, ["health"]);

// The handlers are taken without their dependencies, which is the seam that
// matters here: this app depends on nothing, so its real `Health` can never
// report a failed check, and the 503 half of the readiness contract would be
// untestable without swapping the service.
const withHealth = (health: Health["Service"]) =>
  Layer.mergeAll(
    healthHandlersNoDeps.pipe(Layer.provide(Layer.succeed(Health)(health))),
    HttpServer.layerServices
  );

const OK = { checks: [], status: "ok" } as const;

layer(withHealth(Health.make([])))("health probes", (it) => {
  it.effect("reports the startup probe as ok", () =>
    Effect.gen(function* startup() {
      const client = yield* makeClient;

      assert.deepStrictEqual(yield* client.health.startup(), OK);
    })
  );

  it.effect("reports the liveness probe as ok", () =>
    Effect.gen(function* live() {
      const client = yield* makeClient;

      assert.deepStrictEqual(yield* client.health.live(), OK);
    })
  );

  it.effect("reports the readiness probe as ok with nothing to check", () =>
    Effect.gen(function* ready() {
      const client = yield* makeClient;

      assert.deepStrictEqual(yield* client.health.ready(), OK);
    })
  );
});

// A readiness probe that cannot serve traffic answers 503, and says which check
// failed in the body rather than leaving the caller to infer it from the status.
// `Unhealthy` carries the same fields as the success report, so both halves of
// the contract decode into the same shape.
layer(
  withHealth(
    Health.make([{ name: "db", verify: Effect.fail(new Error("down")) }])
  )
)("readiness probe with a failing check", (it) => {
  it.effect("fails with the report of what broke", () =>
    Effect.gen(function* ready() {
      const client = yield* makeClient;

      const error = yield* Effect.flip(client.health.ready());

      // A throw rather than an assertion, because the field assertions below
      // need the narrowing and `assert.isTrue` does not narrow. The client's
      // error channel also carries transport and decode failures, so this
      // states that the readiness failure arrived as the declared one.
      if (!(error instanceof Unhealthy)) {
        throw new Error(`expected Unhealthy, got ${String(error)}`);
      }

      assert.strictEqual(error.status, "unhealthy");
      assert.deepStrictEqual(error.checks, [{ name: "db", status: "fail" }]);
    })
  );

  // The startup and liveness probes answer for the process, so a dependency
  // being down must not reach them: a liveness failure means "restart me",
  // which a down database is not a reason for.
  it.effect("does not affect the other two probes", () =>
    Effect.gen(function* others() {
      const client = yield* makeClient;

      assert.deepStrictEqual(yield* client.health.startup(), OK);
      assert.deepStrictEqual(yield* client.health.live(), OK);
    })
  );
});
