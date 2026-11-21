import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";

import { Api } from "#app/api.ts";
import { healthHandlers } from "#app/health.ts";
import { Unhealthy } from "#features/health/schema.ts";
import { Health } from "#features/health/service.ts";

const makeClient = HttpApiTest.groups(Api, ["health"]);

const withHealth = (health: Health["Service"]) =>
  Layer.mergeAll(
    healthHandlers.pipe(Layer.provide(Layer.succeed(Health)(health))),
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

layer(
  withHealth(
    Health.make([{ name: "db", verify: Effect.fail(new Error("down")) }])
  )
)("readiness probe with a failing check", (it) => {
  it.effect("fails with the report of what broke", () =>
    Effect.gen(function* ready() {
      const client = yield* makeClient;

      const error = yield* Effect.flip(client.health.ready());

      if (!(error instanceof Unhealthy)) {
        throw new TypeError(`expected Unhealthy, got ${String(error)}`);
      }

      assert.strictEqual(error.status, "unhealthy");
      assert.deepStrictEqual(error.checks, [{ name: "db", status: "fail" }]);
    })
  );

  it.effect("does not affect the other two probes", () =>
    Effect.gen(function* others() {
      const client = yield* makeClient;

      assert.deepStrictEqual(yield* client.health.startup(), OK);
      assert.deepStrictEqual(yield* client.health.live(), OK);
    })
  );
});
